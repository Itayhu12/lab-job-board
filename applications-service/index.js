'use strict';
/**
 * Applications Service — Express
 * Handles job application submissions and status management.
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── DB Pool ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || 'postgres',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'jobboard',
  user:     process.env.DB_USER     || 'jobuser',
  password: process.env.DB_PASSWORD || 'password',
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

/** Health check */
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected' });
  } catch (err) {
    console.error('DB health error:', err.message);
    res.json({ status: 'unhealthy', database: 'disconnected' });
  }
});

/** List all applications */
app.get('/applications/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applications ORDER BY applied_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Submit a new application */
app.post('/applications/', async (req, res) => {
  const { job_id, applicant_name, applicant_email, cover_letter } = req.body;

  if (!job_id || !applicant_name || !applicant_email) {
    return res.status(400).json({
      error: 'job_id, applicant_name, and applicant_email are required',
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO applications (job_id, applicant_name, applicant_email, cover_letter)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [job_id, applicant_name, applicant_email, cover_letter || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23503') {
      return res.status(404).json({ error: `Job ${job_id} not found` });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Get a single application */
app.get('/applications/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applications WHERE id = $1', [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: `Application ${id} not found` });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Get all applications for a specific job */
app.get('/applications/job/:jobId', async (req, res) => {
  const jobId = parseInt(req.params.jobId);
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applications WHERE job_id = $1 ORDER BY applied_at DESC',
      [jobId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Update application status */
app.patch('/applications/:id/status', async (req, res) => {
  const id     = parseInt(req.params.id);
  const { status } = req.body;
  const allowed = ['pending', 'reviewed', 'accepted', 'rejected'];

  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowed.join(', ')}`,
    });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE applications SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: `Application ${id} not found` });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Server ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Applications service listening on port ${PORT}`);
});

module.exports = app; // exported for testing
