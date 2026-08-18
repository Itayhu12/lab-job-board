import React, { useState, useEffect } from 'react';

const API_BASE = '';

const styles = {
  body: { fontFamily: 'system-ui, sans-serif', margin: 0, background: '#f0f4f8', color: '#1a202c' },
  header: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', padding: '1.5rem 2rem', marginBottom: '2rem' },
  h1: { margin: 0, fontSize: '1.8rem' },
  sub: { margin: '0.3rem 0 0', opacity: 0.85, fontSize: '0.95rem' },
  container: { maxWidth: 900, margin: '0 auto', padding: '0 1rem' },
  card: { background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', padding: '1.5rem', marginBottom: '1.2rem' },
  badge: { background: '#ebf4ff', color: '#2b6cb0', borderRadius: 12, padding: '2px 10px', fontSize: '0.78rem', marginRight: 6 },
  btn: { background: '#667eea', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5rem 1.2rem', cursor: 'pointer', fontSize: '0.9rem' },
  btnSm: { background: '#48bb78', color: '#fff', border: 'none', borderRadius: 6, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', marginTop: '0.7rem' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginBottom: '0.7rem', padding: '0.5rem 0.8rem', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: '0.9rem' },
  textarea: { display: 'block', width: '100%', boxSizing: 'border-box', marginBottom: '0.7rem', padding: '0.5rem 0.8rem', border: '1px solid #cbd5e0', borderRadius: 6, fontSize: '0.9rem', minHeight: 80 },
  label: { fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem', display: 'block' },
  section: { marginBottom: '2rem' },
  error: { color: '#e53e3e', fontSize: '0.85rem', marginTop: '0.5rem' },
  success: { color: '#38a169', fontSize: '0.85rem', marginTop: '0.5rem' },
};

function JobCard({ job, onApply }) {
  return (
    <div style={styles.card}>
      <h3 style={{ margin: '0 0 0.4rem' }}>{job.title}</h3>
      <div style={{ marginBottom: '0.6rem' }}>
        <span style={styles.badge}>{job.company}</span>
        <span style={styles.badge}>{job.location}</span>
        {job.salary_range && <span style={styles.badge}>{job.salary_range}</span>}
      </div>
      <p style={{ margin: '0 0 0.8rem', color: '#4a5568', lineHeight: 1.6 }}>{job.description}</p>
      <button style={styles.btnSm} onClick={() => onApply(job)}>Apply Now</button>
    </div>
  );
}

function ApplyModal({ job, onClose }) {
  const [form, setForm]     = useState({ applicant_name: '', applicant_email: '', cover_letter: '' });
  const [msg, setMsg]       = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null); setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/applications/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id, ...form }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setMsg('Application submitted successfully!');
      setForm({ applicant_name: '', applicant_email: '', cover_letter: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ ...styles.card, width: 460, maxWidth: '90vw', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 14, background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}>✕</button>
        <h3 style={{ marginTop: 0 }}>Apply: {job.title}</h3>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Full Name *</label>
          <input style={styles.input} value={form.applicant_name} required onChange={e => setForm(f => ({ ...f, applicant_name: e.target.value }))} />
          <label style={styles.label}>Email *</label>
          <input style={styles.input} type="email" value={form.applicant_email} required onChange={e => setForm(f => ({ ...f, applicant_email: e.target.value }))} />
          <label style={styles.label}>Cover Letter</label>
          <textarea style={styles.textarea} value={form.cover_letter} onChange={e => setForm(f => ({ ...f, cover_letter: e.target.value }))} placeholder="Tell us why you're a great fit..." />
          <button style={styles.btn} type="submit" disabled={loading}>{loading ? 'Submitting…' : 'Submit Application'}</button>
        </form>
        {msg   && <p style={styles.success}>{msg}</p>}
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

function PostJobForm({ onPosted }) {
  const [form, setForm]     = useState({ title: '', description: '', company: '', location: '', salary_range: '' });
  const [msg, setMsg]       = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]     = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(null); setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to create job');
      setMsg('Job posted!');
      setForm({ title: '', description: '', company: '', location: '', salary_range: '' });
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <button style={{ ...styles.btn, background: '#553c9a' }} onClick={() => setOpen(o => !o)}>
        {open ? '▲ Hide Form' : '+ Post a New Job'}
      </button>
      {open && (
        <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
          <label style={styles.label}>Job Title *</label>
          <input style={styles.input} value={form.title} required onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <label style={styles.label}>Description *</label>
          <textarea style={styles.textarea} value={form.description} required onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label style={styles.label}>Company *</label>
          <input style={styles.input} value={form.company} required onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
          <label style={styles.label}>Location *</label>
          <input style={styles.input} value={form.location} required onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
          <label style={styles.label}>Salary Range</label>
          <input style={styles.input} value={form.salary_range} onChange={e => setForm(f => ({ ...f, salary_range: e.target.value }))} placeholder="e.g. $80,000 - $100,000" />
          <button style={styles.btn} type="submit" disabled={loading}>{loading ? 'Posting…' : 'Post Job'}</button>
        </form>
      )}
      {msg   && <p style={styles.success}>{msg}</p>}
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

export default function App() {
  const [jobs, setJobs]         = useState([]);
  const [applyJob, setApplyJob] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const fetchJobs = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/jobs`);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      setJobs(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, []);

  return (
    <div style={styles.body}>
      <div style={styles.header}>
        <div style={styles.container}>
          <h1 style={styles.h1}>🚀 DevSecOps Job Board</h1>
          <p style={styles.sub}>Containerised · Orchestrated · Secured with Docker & GitHub Actions</p>
        </div>
      </div>

      <div style={styles.container}>
        <div style={styles.section}>
          <PostJobForm onPosted={fetchJobs} />
        </div>

        <h2 style={{ marginBottom: '1rem' }}>Available Positions ({jobs.length})</h2>
        {loading && <p>Loading jobs…</p>}
        {error   && <p style={styles.error}>{error}</p>}
        {!loading && !error && jobs.length === 0 && <p>No jobs posted yet.</p>}
        {jobs.map(job => (
          <JobCard key={job.id} job={job} onApply={setApplyJob} />
        ))}
      </div>

      {applyJob && <ApplyModal job={applyJob} onClose={() => setApplyJob(null)} />}
    </div>
  );
}
