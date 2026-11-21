# 💼 JobTrack

**A job application tracker that keeps your whole job search in one place.**

Add the jobs you apply to, schedule interviews, see important dates on a calendar, and check your progress with analytics. Connect your Gmail and JobTrack finds your job-related emails for you.

## ✨ Features

### 📋 Applications
- Add, view, edit and delete job applications
- Search by company or role, filter by status, and sort
- Track each job as Interested, Applied, Interview, Selected or Rejected
- Save follow-up dates, deadlines, notes and the job link

### 🎤 Interviews
- Add interview rounds to any application
- Save the type, date and time, meeting link, notes and result

### 📅 Calendar
- Month and week views of applications, interviews, follow-ups and deadlines
- Click a day to see its details, or add something on that day

### 📊 Analytics
- Applications over time and daily activity
- How many applications are in each status
- Top companies, roles and locations
- Response rate and interview rate

### 📧 Gmail integration
- Connect your Gmail account with Google sign-in (read-only)
- JobTrack looks through your inbox and picks out the emails about your job applications, such as "application received", interview invitations, offers and rejections
- Adverts, job alerts and newsletters are left out
- Add a job to your tracker from an email with one click
- If the email is about a job you already track, JobTrack suggests updating its status
- **Note:** Gmail access uses a Google OAuth app in testing mode, so it works for approved test accounts only. To try it, add your own Google OAuth credentials in `.env`. All other features work without Gmail.

### 🏠 Dashboard
- Total applications, interviews and selections at a glance
- Recent applications and what is coming up in the next 7 days

### 👤 Account
- Sign up, log in, edit your profile, change password, delete account

### 🎨 Interface
- Light and dark mode
- Works on mobile, tablet and desktop

## 🔒 Security

- Login tokens are stored in HttpOnly cookies, so scripts cannot read them
- CSRF protection, and rate limiting on login and sign-up
- Each user can see only their own data
- Gmail tokens are encrypted in the database
- Passwords and keys are kept in environment variables, not in the code

## 🛠️ Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, Vite, Axios |
| Backend | Python 3.12, Django 6, Django REST Framework, Simple JWT |
| Database | PostgreSQL 17 |
| Integrations | Gmail API, Google OAuth 2.0 |
| Deployment | Docker, Docker Compose, nginx, Gunicorn |

## 🚀 Getting started

Copy `.env.example` to `.env` and fill in the values.

### With Docker

```bash
docker compose up --build
```

Open http://localhost:8080

### Without Docker

You need Python 3.12, Node.js 22 and PostgreSQL 17.

Backend:

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Frontend (in a second terminal):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## ✅ Tests

```bash
python manage.py test
```

80 automated tests cover login, profile, applications, interviews, analytics and the Gmail integration.

## 📁 Project structure

```
config/          Django settings and URLs
jobs/            Backend: models, API views, Gmail integration, tests
frontend/src/    Frontend: pages, components, layout
```

## 👩‍💻 Author

**Mahvish**
