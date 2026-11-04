//! Store-level behaviour: versions, ordering, status filtering.

use announcement_service::db::{content_version, AnnouncementChanges, NewAnnouncement, Store};
use tempfile::TempDir;

fn store() -> (Store, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("db.sqlite")).unwrap();
    (store, dir)
}

fn new(title: &str, body: &str, published_at: Option<&str>, status: &str) -> NewAnnouncement {
    NewAnnouncement {
        title: title.to_string(),
        body_md: body.to_string(),
        published_at: published_at.map(str::to_string),
        status: status.to_string(),
    }
}

fn status(value: &str) -> AnnouncementChanges {
    AnnouncementChanges {
        status: Some(value.to_string()),
        ..Default::default()
    }
}

#[test]
fn content_version_tracks_title_and_body_only() {
    assert_eq!(
        content_version("标题", "正文"),
        content_version("标题", "正文")
    );
    assert_ne!(
        content_version("标题", "正文"),
        content_version("标题", "正文2")
    );
    assert_ne!(
        content_version("标题", "正文"),
        content_version("标题2", "正文")
    );
    assert_eq!(content_version("A", "B").len(), 16);
}

#[test]
fn content_version_matches_the_python_service() {
    // hashlib.sha256("A\nB".encode()).hexdigest()[:16], computed by the earlier Python implementation.
    assert_eq!(content_version("A", "B"), "23519a43c66b4c34");
}

#[test]
fn create_defaults_to_published_now() {
    let (store, _dir) = store();
    let created = store
        .create(new("停机升级", "今晚 22:00", None, "published"))
        .unwrap();
    assert_eq!(created.status, "published");
    assert!(created.published_at.ends_with('Z'));
    assert_eq!(created.updated_at, created.published_at);
    assert_eq!(
        created.content_version,
        content_version("停机升级", "今晚 22:00")
    );
    assert_eq!(created.id.len(), 12);
}

#[test]
fn empty_published_at_means_now() {
    let (store, _dir) = store();
    let created = store.create(new("A", "", Some(""), "published")).unwrap();
    assert!(created.published_at.ends_with('Z'));
}

#[test]
fn only_editing_content_changes_the_version() {
    let (store, _dir) = store();
    let created = store.create(new("A", "B", None, "published")).unwrap();

    let same = store
        .update(&created.id, &status("unpublished"))
        .unwrap()
        .unwrap();
    assert_eq!(same.content_version, created.content_version);
    assert!(same.updated_at >= created.updated_at);

    let edited = store
        .update(
            &created.id,
            &AnnouncementChanges {
                body_md: Some("B2".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .unwrap();
    assert_ne!(edited.content_version, created.content_version);
}

#[test]
fn public_feed_excludes_unpublished_and_sorts_newest_first() {
    let (store, _dir) = store();
    let first = store
        .create(new("早", "", Some("2026-01-01T00:00:00Z"), "published"))
        .unwrap();
    let second = store
        .create(new("晚", "", Some("2026-02-01T00:00:00Z"), "published"))
        .unwrap();
    let hidden = store.create(new("草稿", "", None, "unpublished")).unwrap();

    let published: Vec<String> = store
        .list_published()
        .unwrap()
        .into_iter()
        .map(|item| item.id)
        .collect();
    assert_eq!(published, [second.id.clone(), first.id.clone()]);
    assert!(!published.contains(&hidden.id));
    assert_eq!(store.list_all().unwrap().len(), 3);
}

#[test]
fn update_missing_and_delete() {
    let (store, _dir) = store();
    assert!(store
        .update(
            "nope",
            &AnnouncementChanges {
                title: Some("x".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .is_none());
    let created = store.create(new("A", "", None, "published")).unwrap();
    assert!(store.delete(&created.id).unwrap());
    assert!(!store.delete(&created.id).unwrap());
}

#[test]
fn rejects_unknown_status() {
    let (store, _dir) = store();
    assert!(store.create(new("A", "", None, "draft")).is_err());
}

#[test]
fn opens_an_existing_database_written_by_the_python_schema() {
    // The table and index definitions must stay byte-compatible with the Python service.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE announcements (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '',
                published_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('published', 'unpublished')),
                content_version TEXT NOT NULL, updated_at TEXT NOT NULL);
             INSERT INTO announcements VALUES ('abc123def456', '旧', '正文', '2026-01-01T00:00:00Z',
                'published', '0123456789abcdef', '2026-01-01T00:00:00Z');",
        )
        .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let published = store.list_published().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].title, "旧");
}
