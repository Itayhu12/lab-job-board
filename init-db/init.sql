-- Job Board Database Initialization Script
-- This runs automatically when the PostgreSQL container starts

-- Create jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(255)   NOT NULL,
    description TEXT           NOT NULL,
    company     VARCHAR(255)   NOT NULL,
    location    VARCHAR(255)   NOT NULL,
    salary_range VARCHAR(100),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create applications table
CREATE TABLE IF NOT EXISTS applications (
    id               SERIAL PRIMARY KEY,
    job_id           INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    applicant_name   VARCHAR(255) NOT NULL,
    applicant_email  VARCHAR(255) NOT NULL,
    cover_letter     TEXT,
    status           VARCHAR(50)  DEFAULT 'pending'
                        CHECK (status IN ('pending', 'reviewed', 'accepted', 'rejected')),
    applied_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed data
INSERT INTO jobs (title, description, company, location, salary_range) VALUES
  ('DevSecOps Engineer',
   'Design and implement secure CI/CD pipelines, vulnerability scanning, and container security.',
   'CloudSecure Ltd',
   'Tel Aviv, Israel',
   '$90,000 - $130,000'),
  ('Site Reliability Engineer',
   'Maintain platform reliability, on-call rotations, SLO/SLA management with Kubernetes.',
   'TechOps Inc',
   'Remote',
   '$100,000 - $145,000'),
  ('Backend Developer (Python)',
   'Build FastAPI microservices with PostgreSQL and Docker for fintech platform.',
   'FinTech Startup',
   'Herzliya, Israel',
   '$80,000 - $115,000');

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_status  ON applications(status);
