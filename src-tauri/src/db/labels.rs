use super::*;

impl MailStore {
    pub fn create_label(&self, name: &str, color: &str) -> MailResult<Label> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO labels(name, color) VALUES (?1, ?2)",
                params![name, color],
            )?;
            let id = conn.last_insert_rowid();
            Ok(Label {
                id,
                name: name.to_string(),
                color: color.to_string(),
                message_count: 0,
            })
        })
    }
    pub fn update_label(&self, id: i64, name: &str, color: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE labels SET name = ?1, color = ?2 WHERE id = ?3",
                params![name, color, id],
            )?;
            Ok(())
        })
    }
    pub fn delete_label(&self, id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM message_labels WHERE label_id = ?1",
                params![id],
            )?;
            conn.execute("DELETE FROM labels WHERE id = ?1", params![id])?;
            Ok(())
        })
    }
    pub fn list_labels(&self) -> MailResult<Vec<Label>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT l.id, l.name, l.color, COUNT(ml.message_id) AS message_count
                FROM labels l
                LEFT JOIN message_labels ml ON ml.label_id = l.id
                GROUP BY l.id, l.name, l.color
                ORDER BY l.name
                ",
            )?;
            let labels = stmt
                .query_map([], |row| {
                    Ok(Label {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                        message_count: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(labels)
        })
    }
}

