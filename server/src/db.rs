//! SQLite storage for announcements.
//!
//! One table, one file. Every write bumps `updated_at`; changing the title or
//! the body also recomputes `content_version`, which is what makes a tenant's
//! "got it" dismissal expire.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const PUBLISHED: &str = "published";
pub const UNPUBLISHED: &str = "unpublished";
pub const STATUSES: [&str; 2] = [PUBLISHED, UNPUBLISHED];

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS announcements (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    body_md         TEXT NOT NULL DEFAULT '',
    published_at    TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('published', 'unpublished')),
    content_version TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_feed
    ON announcements (status, published_at DESC, id DESC);
";

const COLUMNS: &str = "id, title, body_md, published_at, status, content_version, updated_at";

/// Second-resolution UTC timestamp in the ISO shape JavaScript parses.
pub fn utc_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Version derived from the content itself: first 8 bytes of sha256(title + "\n" + body), hex.
///
/// An operator editing either field produces a new version without bumping
/// anything by hand, which re-shows the announcement to everyone who dismissed
/// the old text.
pub fn content_version(title: &str, body_md: &str) -> String {
    let digest = Sha256::digest(format!("{title}\n{body_md}").as_bytes());
    hex_prefix(&digest, 8)
}

pub(crate) fn hex_prefix(bytes: &[u8], count: usize) -> String {
    bytes
        .iter()
        .take(count)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Announcement {
    pub id: String,
    pub title: String,
    pub body_md: String,
    pub published_at: String,
    pub status: String,
    pub content_version: String,
    pub updated_at: String,
}

/// The subset a tenant may see.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublicAnnouncement {
    pub id: String,
    pub title: String,
    pub body_md: String,
    pub published_at: String,
    pub content_version: String,
}

impl From<&Announcement> for PublicAnnouncement {
    fn from(item: &Announcement) -> Self {
        Self {
            id: item.id.clone(),
            title: item.title.clone(),
            body_md: item.body_md.clone(),
            published_at: item.published_at.clone(),
            content_version: item.content_version.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAnnouncement {
    pub title: String,
    pub body_md: String,
    /// `None` or empty means "now".
    pub published_at: Option<String>,
    pub status: String,
}

/// Fields to change; `None` leaves the stored value alone.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AnnouncementChanges {
    pub title: Option<String>,
    pub body_md: Option<String>,
    pub published_at: Option<String>,
    pub status: Option<String>,
}

impl AnnouncementChanges {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.body_md.is_none()
            && self.published_at.is_none()
            && self.status.is_none()
    }
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("could not create the database directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("status must be one of published, unpublished, got {0:?}")]
    InvalidStatus(String),
}

/// Announcement CRUD over one SQLite connection, serialized by a mutex.
#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    /// Open (creating the directory and the schema if needed).
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(10))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn list_all(&self) -> Result<Vec<Announcement>, StoreError> {
        let conn = self.lock();
        query_all(
            &conn,
            &format!("SELECT {COLUMNS} FROM announcements ORDER BY published_at DESC, id DESC"),
            &[],
        )
    }

    pub fn list_published(&self) -> Result<Vec<Announcement>, StoreError> {
        let conn = self.lock();
        query_all(
            &conn,
            &format!(
                "SELECT {COLUMNS} FROM announcements WHERE status = ?1 ORDER BY published_at DESC, id DESC"
            ),
            &[&PUBLISHED],
        )
    }

    pub fn get(&self, announcement_id: &str) -> Result<Option<Announcement>, StoreError> {
        let conn = self.lock();
        get_locked(&conn, announcement_id)
    }

    pub fn create(&self, new: NewAnnouncement) -> Result<Announcement, StoreError> {
        check_status(&new.status)?;
        let now = utc_now();
        let announcement = Announcement {
            id: uuid::Uuid::new_v4().simple().to_string()[..12].to_string(),
            content_version: content_version(&new.title, &new.body_md),
            published_at: new
                .published_at
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| now.clone()),
            title: new.title,
            body_md: new.body_md,
            status: new.status,
            updated_at: now,
        };
        let conn = self.lock();
        conn.execute(
            &format!("INSERT INTO announcements ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"),
            params![
                announcement.id,
                announcement.title,
                announcement.body_md,
                announcement.published_at,
                announcement.status,
                announcement.content_version,
                announcement.updated_at,
            ],
        )?;
        Ok(announcement)
    }

    /// Returns `None` when the id does not exist.
    pub fn update(
        &self,
        announcement_id: &str,
        changes: &AnnouncementChanges,
    ) -> Result<Option<Announcement>, StoreError> {
        let conn = self.lock();
        let Some(current) = get_locked(&conn, announcement_id)? else {
            return Ok(None);
        };

        let title = changes
            .title
            .clone()
            .unwrap_or_else(|| current.title.clone());
        let body_md = changes
            .body_md
            .clone()
            .unwrap_or_else(|| current.body_md.clone());
        let published_at = changes
            .published_at
            .clone()
            .unwrap_or_else(|| current.published_at.clone());
        let status = changes
            .status
            .clone()
            .unwrap_or_else(|| current.status.clone());
        check_status(&status)?;

        let version = if title != current.title || body_md != current.body_md {
            content_version(&title, &body_md)
        } else {
            current.content_version.clone()
        };

        let updated = Announcement {
            id: current.id,
            title,
            body_md,
            published_at,
            status,
            content_version: version,
            updated_at: utc_now(),
        };
        conn.execute(
            "UPDATE announcements SET title = ?1, body_md = ?2, published_at = ?3, status = ?4,
                content_version = ?5, updated_at = ?6 WHERE id = ?7",
            params![
                updated.title,
                updated.body_md,
                updated.published_at,
                updated.status,
                updated.content_version,
                updated.updated_at,
                updated.id,
            ],
        )?;
        Ok(Some(updated))
    }

    pub fn delete(&self, announcement_id: &str) -> Result<bool, StoreError> {
        let conn = self.lock();
        let removed = conn.execute(
            "DELETE FROM announcements WHERE id = ?1",
            params![announcement_id],
        )?;
        Ok(removed > 0)
    }
}

fn get_locked(
    conn: &Connection,
    announcement_id: &str,
) -> Result<Option<Announcement>, StoreError> {
    let found = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM announcements WHERE id = ?1"),
            params![announcement_id],
            from_row,
        )
        .optional()?;
    Ok(found)
}

fn query_all(
    conn: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Announcement>, StoreError> {
    let mut statement = conn.prepare(sql)?;
    let rows = statement
        .query_map(args, from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn from_row(row: &Row<'_>) -> rusqlite::Result<Announcement> {
    Ok(Announcement {
        id: row.get(0)?,
        title: row.get(1)?,
        body_md: row.get(2)?,
        published_at: row.get(3)?,
        status: row.get(4)?,
        content_version: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn check_status(status: &str) -> Result<(), StoreError> {
    if STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(StoreError::InvalidStatus(status.to_string()))
    }
}
