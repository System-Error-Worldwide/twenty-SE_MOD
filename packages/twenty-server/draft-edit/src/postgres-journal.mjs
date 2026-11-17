export class PostgresJournal {
  constructor(pool) { this.pool = pool; }

  async claim({ operationId, targetKey, expectedRevision }) {
    const result = await this.pool.query(
      `INSERT INTO draft_edit_operation (operation_id, target_key, expected_revision, state, details)
       VALUES ($1, $2, $3, 'active', $4::jsonb) ON CONFLICT DO NOTHING RETURNING operation_id`,
      [operationId, targetKey, expectedRevision, JSON.stringify({ phase: 'claimed' })],
    );
    return result.rowCount === 1 ? { acquired: true } : { acquired: false, reason: 'operation_or_target_busy' };
  }

  async mark(operationId, details) {
    const result = await this.pool.query(
      `UPDATE draft_edit_operation SET details = $2::jsonb, updated_at = now()
       WHERE operation_id = $1 AND state = 'active' RETURNING operation_id`,
      [operationId, JSON.stringify(details)],
    );
    if (result.rowCount !== 1) throw new Error('Journal operation is not active');
  }

  async finish(operationId, details) {
    const result = await this.pool.query(
      `UPDATE draft_edit_operation SET state = 'finished', details = $2::jsonb, updated_at = now()
       WHERE operation_id = $1 AND state = 'active' RETURNING operation_id`,
      [operationId, JSON.stringify(details)],
    );
    if (result.rowCount !== 1) throw new Error('Journal operation is not active');
  }
}
