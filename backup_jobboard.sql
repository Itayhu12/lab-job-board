--
-- PostgreSQL database dump
--

\restrict DWqL5ujtmYS3G50cBj0KAEQKTefbWdxjbr1XRBMdnq9NMFkKXacgav96ePJrlyW

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id integer NOT NULL,
    job_id integer,
    applicant_name character varying(255) NOT NULL,
    applicant_email character varying(255) NOT NULL,
    cover_letter text,
    status character varying(50) DEFAULT 'pending'::character varying,
    applied_at timestamp with time zone DEFAULT now(),
    CONSTRAINT applications_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'accepted'::character varying, 'rejected'::character varying])::text[])))
);


--
-- Name: applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.applications_id_seq OWNED BY public.applications.id;


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    company character varying(255) NOT NULL,
    location character varying(255) NOT NULL,
    salary_range character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;


--
-- Name: applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications ALTER COLUMN id SET DEFAULT nextval('public.applications_id_seq'::regclass);


--
-- Name: jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);


--
-- Data for Name: applications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.applications (id, job_id, applicant_name, applicant_email, cover_letter, status, applied_at) FROM stdin;
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.jobs (id, title, description, company, location, salary_range, created_at, updated_at) FROM stdin;
1	DevSecOps Engineer	Design and implement secure CI/CD pipelines, vulnerability scanning, and container security.	CloudSecure Ltd	Tel Aviv, Israel	$90,000 - $130,000	2026-08-16 09:01:04.781166+00	2026-08-16 09:01:04.781166+00
2	Site Reliability Engineer	Maintain platform reliability, on-call rotations, SLO/SLA management with Kubernetes.	TechOps Inc	Remote	$100,000 - $145,000	2026-08-16 09:01:04.781166+00	2026-08-16 09:01:04.781166+00
3	Backend Developer (Python)	Build FastAPI microservices with PostgreSQL and Docker for fintech platform.	FinTech Startup	Herzliya, Israel	$80,000 - $115,000	2026-08-16 09:01:04.781166+00	2026-08-16 09:01:04.781166+00
4	Persistence Test Job	Testing Docker volumes	Lab Inc	Docker	\N	2026-08-16 13:01:01.930274+00	2026-08-16 13:01:01.930274+00
5	Backend Engineer	Build APIs with Python	TechCorp	Tel Aviv	\N	2026-08-16 13:13:34.00134+00	2026-08-16 13:13:34.00134+00
6	DevOps Engineer	Manage CI/CD pipelines	CloudCo	Remote	\N	2026-08-16 13:13:34.046556+00	2026-08-16 13:13:34.046556+00
\.


--
-- Name: applications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.applications_id_seq', 1, false);


--
-- Name: jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.jobs_id_seq', 6, true);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: idx_applications_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_job_id ON public.applications USING btree (job_id);


--
-- Name: idx_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_status ON public.applications USING btree (status);


--
-- Name: applications applications_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict DWqL5ujtmYS3G50cBj0KAEQKTefbWdxjbr1XRBMdnq9NMFkKXacgav96ePJrlyW

