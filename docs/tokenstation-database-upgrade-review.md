# TokenStation database upgrade review

Pre-release review. The production baseline `c7288771` targets database schema version 9, while the locally merged release `678376a8` targets version 11. On its first startup, the merged release automatically applies pending migrations before serving requests. Reusing the existing deployment scripts and database connection also triggers these migrations.

| Version | Migration |
| --- | --- |
| 10 | Create `subscription_oauth_hosts` and `subscription_oauth_registrations` to store subscription OAuth hosts and registrations |
| 11 | Create `responses_image_store_bindings` and an expiration index for Responses API image resource associations |

Both migrations update the migration ledger. Their SQL does not change columns or indexes on existing business tables, nor does it delete existing business tables. Existing startup data processing still runs.

`c7288771` accepts only schemas 8 through 9. Once the database reaches version 11, rolling back the application alone cannot restore the older service. Isolated local SQLite and PostgreSQL databases have been used to verify `9 → 11` and the subsequent `db verify`. At the time of this review, the merged release has not been deployed and production has not applied these migrations.

## Pending decisions

- Decide whether production may advance to schema 11.
- If approved, confirm backups, restoration rehearsals, and how writes made after cutover will be handled during rollback.
- If schema 9 must be retained, use `c7288771` as the baseline to select upstream changes that require no new tables, then verify startup and primary endpoints against a schema 9 test database.
