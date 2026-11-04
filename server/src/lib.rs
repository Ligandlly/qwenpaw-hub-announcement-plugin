//! Central announcement service for QwenPaw Hub tenants.
//!
//! One process serves the admin API, the tenant read-only feed and the admin
//! page, backed by a single SQLite file.

pub mod app;
pub mod auth;
pub mod config;
pub mod db;

pub use app::create_app;
pub use config::Settings;
pub use db::{Announcement, Store};
