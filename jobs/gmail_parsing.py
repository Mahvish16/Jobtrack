"""
Turns a Gmail message (subject, sender, snippet) into job-application data.

Everything here is a pure function: text in, text out, no database and no
network. That makes the rules easy to unit-test (see jobs/tests.py).
"""

import base64
import html
import re

# Senders that deliver mail on behalf of many employers. Their name or
# domain is never the company the user applied to.
JOB_BOARDS = {
    'linkedin', 'indeed', 'naukri', 'glassdoor', 'foundit', 'monster',
    'internshala', 'wellfound', 'angel', 'hirist', 'instahyre', 'cutshort',
    'shine', 'timesjobs', 'unstop', 'greenhouse', 'lever', 'workday',
    'myworkday', 'myworkdayjobs', 'smartrecruiters', 'ashbyhq', 'icims',
    'workable', 'bamboohr', 'jobvite', 'taleo', 'successfactors',
    'zohorecruit', 'freshteam', 'keka', 'darwinbox', 'ziprecruiter',
}

GENERIC_DOMAINS = {
    'gmail', 'googlemail', 'yahoo', 'outlook', 'hotmail', 'live', 'icloud',
    'rediffmail', 'protonmail', 'proton', 'aol', 'zoho', 'mail',
}

# Checked in this order: a rejection also contains words like
# "application" and "interview", so the most specific category goes first.
CATEGORY_KEYWORDS = [
    ('rejection', [
        'unfortunately', 'regret to inform', 'not moving forward',
        'not be moving forward', 'not selected', 'other candidates',
        'decided not to proceed', 'will not be proceeding',
        'not to move forward', 'unable to offer', 'position has been filled',
        'not shortlisted',
    ]),
    ('offer', [
        'offer letter', 'pleased to offer', 'job offer', 'delighted to offer',
        'happy to offer', 'offer of employment', 'extend an offer',
        'you have been selected',
    ]),
    ('interview', [
        'interview', 'schedule a call', 'technical round', 'assessment',
        'coding test', 'online test', 'coding challenge', 'screening call',
        'hackerrank', 'shortlisted',
    ]),
    ('confirmation', [
        'application received', 'thank you for applying',
        'thanks for applying', 'received your application',
        'application was sent', 'successfully applied',
        'application submitted', 'has been received',
        'application has been sent', 'your application', 'applied to',
        'applied for', 'thank you for your interest',
        'successfully submitted', 'application received',
    ]),
]

# Which application status each kind of email points to.
CATEGORY_STATUS = {
    'confirmation': 'Applied',
    'interview': 'Interview',
    'rejection': 'Rejected',
    'offer': 'Selected',
    'other': 'Applied',
}

# How far along an application is. Used to decide whether an email
# should move an existing application forward.
STATUS_RANK = {'Interested': 0, 'Applied': 1, 'Interview': 2, 'Selected': 3}

# A role ends at " at Acme", " - Acme", punctuation, or the end of the text.
# A hyphen inside a word ("Front-end") does not end it.
_ROLE_END = (
    r"(?:\s+(?:position|role|opening|job))?"
    r"(?=\s+(?:at|with)\s|\s+[-–—|@]\s|\s*[(\[,!:;]|\.(?:\s|$)|\s*$)"
)

ROLE_PATTERNS = [
    re.compile(r"indeed application:\s*(.+)$", re.I),
    re.compile(r"application received:\s*(.+?)" + _ROLE_END, re.I),
    # "for" introduces the role. ("applying to Acme" names the company.)
    re.compile(
        r"application (?:with .+? )?for (?:the )?(?:position of |role of |post of )?(.+?)" + _ROLE_END,
        re.I,
    ),
    re.compile(
        r"appl(?:y|ied|ying) for (?:the )?(?:position of |role of |post of )?(.+?)" + _ROLE_END,
        re.I,
    ),
    re.compile(
        r"interview (?:invitation )?for (?:the )?(?:position of |role of )?(.+?)" + _ROLE_END,
        re.I,
    ),
    re.compile(r"(?:position|role|post) of (.+?)" + _ROLE_END, re.I),
    re.compile(r"interest in (?:the )?(.+?)\s+(?:position|role|opening)\b", re.I),
    # "About your Software Development Intern application"
    re.compile(r"\byour ((?:[A-Z][\w.&/+-]*\s+){1,5}?)application\b"),
]

_COMPANY_NAME = r"([A-Z0-9][\w&.'’-]*(?:\s+[A-Z0-9&][\w&.'’-]*){0,4})"

COMPANY_PATTERNS = [
    re.compile(r"application (?:was|has been) sent to " + _COMPANY_NAME),
    re.compile(r"[Aa]pplication (?:to|with) " + _COMPANY_NAME + r"(?= successfully| has | was | for |$)"),
    # LinkedIn writes some company names in lower case here.
    re.compile(r"application was viewed by ([\w&.'\u2019 -]{2,40}?)\s*$"),
    re.compile(r"\b(?:at|with|@)\s+" + _COMPANY_NAME),
    re.compile(r"\binterest in (?:joining )?" + _COMPANY_NAME),
    re.compile(r"\b(?:applying|applied|application) to " + _COMPANY_NAME),
    re.compile(r"^" + _COMPANY_NAME + r"\s*[:|–—-]\s"),
]

# Words that pad a sender name: "Acme Careers", "Acme Recruiting Team".
SENDER_NOISE = re.compile(
    r"\b(careers?|recruit(?:ing|ment|er)?|talent(?: acquisition)?|hiring|"
    r"team|jobs?|hr|human resources|no[- ]?reply|notifications?|alerts?|"
    r"people ops|people)\b",
    re.I,
)

# Phrases that look like a role or company to a regex but are not one.
NOT_A_ROLE = {
    'a job', 'this job', 'the job', 'this position', 'the position',
    'this role', 'the role', 'a position', 'a role', 'us', 'our company',
    'your application', 'our team', 'the opening', 'jobs', 'job',
    'this', 'it', 'that', 'the same', 'this opportunity', 'an opening',
}

NOT_A_COMPANY = {
    'the', 'our', 'this', 'your', 'you', 'we', 'us', 'thank', 'thanks',
    'dear', 'hi', 'hello', 'regards', 'team', 'update', 'reminder',
    'application', 'about', 'new',
}


# Words that start the "event" part of a subject line rather than the
# company name: "TCS Walk-In Interview 2026" -> "TCS".
EVENT_WORDS = re.compile(
    r"\s+(walk[- ]?in|interview|hiring|recruitment|off[- ]?campus|"
    r"campus|drive|careers?|jobs?|openings?|vacanc(?:y|ies)|is hiring)\b.*$",
    re.I,
)


def _clean(text):
    return re.sub(r"\s+", " ", text or "").strip(" \t\"'“”.,:;-|")


def parse_sender(sender):
    """'Acme Careers <jobs@acme.com>' -> ('Acme Careers', 'acme')."""
    sender = sender or ""
    display_name = _clean(sender.split("<")[0])

    if "@" in display_name:
        display_name = ""

    match = re.search(r"[\w.+-]+@([\w.-]+)", sender)
    domain_root = ""

    if match:
        parts = match.group(1).lower().split(".")
        # jobs.acme.co.in -> acme ; mail.acme.com -> acme
        if len(parts) >= 3 and parts[-2] in ('co', 'com', 'org', 'net', 'ac'):
            domain_root = parts[-3]
        elif len(parts) >= 2:
            domain_root = parts[-2]
        else:
            domain_root = parts[0]

    return display_name, domain_root


def classify_email(subject, snippet):
    text = f"{subject or ''} {snippet or ''}".lower()

    for category, keywords in CATEGORY_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return category

    return 'other'


def extract_role(subject, snippet):
    # The subject line is more reliable than the body preview.
    for text in (subject or "", snippet or ""):
        for pattern in ROLE_PATTERNS:
            match = pattern.search(text)

            if not match:
                continue

            role = _clean(match.group(1))

            if 2 <= len(role) <= 80 and role.lower() not in NOT_A_ROLE:
                return role

    return ""


def _is_job_board(name):
    words = re.findall(r"[a-z0-9]+", (name or "").lower())

    return any(word in JOB_BOARDS for word in words)


def extract_company(subject, snippet, sender):
    for text in (subject or "", snippet or ""):
        for pattern in COMPANY_PATTERNS:
            match = pattern.search(text)

            if not match:
                continue

            company = _clean(EVENT_WORDS.sub("", match.group(1)))

            if (
                len(company) >= 2
                and company.lower() not in NOT_A_COMPANY
                and company.split()[0].lower() not in NOT_A_COMPANY
                and not _is_job_board(company)
            ):
                return company

    # Fall back to who sent it, unless that is a job board or a mailbox
    # provider such as gmail.com.
    display_name, domain_root = parse_sender(sender)

    name = _clean(re.sub(r"\s+via\s+.+$", "", display_name, flags=re.I))
    name = _clean(SENDER_NOISE.sub(" ", name))

    if len(name) >= 2 and not _is_job_board(name) and not _is_job_board(display_name):
        return name

    if (
        domain_root
        and domain_root not in JOB_BOARDS
        and domain_root not in GENERIC_DOMAINS
    ):
        return domain_root.capitalize()

    return ""


def suggest_status_update(current_status, category):
    """Returns the status an email suggests for an existing application,
    or None when the email does not move the application forward."""
    new_status = CATEGORY_STATUS.get(category)

    if category in ('other', 'confirmation') or new_status == current_status:
        return None

    if category == 'rejection':
        # A rejection can follow any stage except a final decision.
        return None if current_status in ('Rejected', 'Selected') else 'Rejected'

    if current_status == 'Rejected':
        return None

    if STATUS_RANK.get(new_status, 0) > STATUS_RANK.get(current_status, 0):
        return new_status

    return None


def find_matching_job(company, jobs):
    """Finds the user's existing application for the same company."""
    name = (company or "").strip().lower()

    if len(name) < 2:
        return None

    for job in jobs:
        existing = job.company_name.strip().lower()

        if existing == name:
            return job

    for job in jobs:
        existing = job.company_name.strip().lower()

        # "Acme" should match "Acme Corp" (and the other way round).
        if len(existing) >= 3 and len(name) >= 3 and (
            re.search(rf"\b{re.escape(name)}\b", existing)
            or re.search(rf"\b{re.escape(existing)}\b", name)
        ):
            return job

    return None


# ---------------------------------------------------------------
# Full message text
# ---------------------------------------------------------------

MAX_BODY_LENGTH = 4000


def _decode_part(data):
    """Gmail sends message text as URL-safe base64."""
    if not data:
        return ""

    padded = data + "=" * (-len(data) % 4)

    try:
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
    except (ValueError, TypeError):
        return ""


def _find_part(payload, mime_type):
    """An email is a tree of parts (plain text, HTML, attachments).
    Returns the text of the first part with the wanted type."""
    if not payload:
        return ""

    if payload.get("mimeType") == mime_type and not payload.get("filename"):
        text = _decode_part(payload.get("body", {}).get("data"))

        if text.strip():
            return text

    for part in payload.get("parts", []) or []:
        text = _find_part(part, mime_type)

        if text:
            return text

    return ""


def _html_to_text(markup):
    # Drop invisible blocks, turn line-breaking tags into new lines,
    # then remove every remaining tag.
    markup = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h[1-6]|table)>", "\n", markup)
    markup = re.sub(r"(?s)<[^>]+>", " ", markup)

    return html.unescape(markup)


def extract_body(payload):
    """The readable text of a Gmail message: the plain-text part if there
    is one, otherwise the HTML part with its tags removed."""
    text = _find_part(payload, "text/plain")

    if not text:
        text = _html_to_text(_find_part(payload, "text/html"))

    # Tidy the spacing: no trailing spaces, no long runs of blank lines.
    text = text.replace("\r\n", "\n").replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()

    if len(text) > MAX_BODY_LENGTH:
        text = text[:MAX_BODY_LENGTH].rstrip() + "\n[message shortened]"

    return text


# ---------------------------------------------------------------
# Is this email about an application the user actually made?
# ---------------------------------------------------------------

# Bulk mail: job adverts, alerts and newsletters. These talk ABOUT jobs but
# are not a reply to something the user applied for.
NOISE_SENDERS = re.compile(
    r"newsletter|digest|job[-_ ]?alert|jobalerts?|recommend|marketing|"
    r"promo|updates@|news@|community|career for freshers|"
    r"bootcamp|courses?[@.]|academy|free online courses",
    re.I,
)

NOISE_PHRASES = [
    'walk-in', 'walk in', 'walkin', 'hiring drive', 'recruitment drive',
    'off campus', 'off-campus', 'job alert', 'jobs for you',
    'jobs you may', 'recommended jobs', 'new jobs', 'jobs matching',
    'is hiring', 'are hiring', 'we are hiring', "we're hiring",
    'apply now', 'apply here', 'apply before', 'openings for',
    'opportunities for freshers', 'job opportunities', 'top jobs',
    'similar jobs', 'jobs near', 'unsubscribe',
    # "application" meaning a piece of software, not a job application
    'oauth', 'third-party application', 'third party application',
    'authorized to access', 'app password', 'sign-in attempt',
    'security alert', 'verify your email', 'verification code',
    'tips for your', 'how to write',
    # course sellers and reminders about an application NOT yet sent
    'confirm your application', 'finish your application',
    'complete your application', 'continue your application',
    'fee structure', 'masterclass', 'webinar',
]

# The four kinds of email that follow a real application.
APPLICATION_CATEGORIES = {'confirmation', 'interview', 'rejection', 'offer'}


def is_application_email(subject, sender, snippet):
    """True only for mail that looks like a reply to the user's own
    application: a confirmation, an interview invitation, a rejection or
    an offer. Adverts, alerts, newsletters and account notices are out."""
    if NOISE_SENDERS.search(sender or ""):
        return False

    text = f"{subject or ''} {snippet or ''}".lower()

    if any(phrase in text for phrase in NOISE_PHRASES):
        return False

    return classify_email(subject, snippet) in APPLICATION_CATEGORIES


# Invisible characters that senders use to pad the preview text.
_INVISIBLE = re.compile("[\u034f\u200b-\u200f\u2060\ufeff\u00ad]")


def clean_snippet(snippet):
    """Gmail's preview with HTML codes (&amp;) decoded and invisible
    padding removed."""
    text = _INVISIBLE.sub("", html.unescape(snippet or ""))

    return re.sub(r"\s+", " ", text).strip()


def extract_details_from_body(body):
    """Extra details found only in the full message text.

    LinkedIn's confirmation looks like this, one item per line:

        Your application was sent to Kumaran Systems

        Python/Django Developer
        Kumaran Systems
        Chennai
        View job: https://www.linkedin.com/comm/jobs/view/123/?tracking=...
    """
    details = {'role': '', 'location': '', 'job_url': ''}
    lines = [line.strip() for line in (body or "").split("\n") if line.strip()]

    if lines and re.match(r"your application was sent to ", lines[0], re.I):
        company = lines[0][len("your application was sent to "):].strip().lower()

        if len(lines) > 1 and len(lines[1]) <= 150:
            details['role'] = lines[1]

        # Company name again, then the city.
        if len(lines) > 3 and lines[2].lower() == company and len(lines[3]) <= 80 \
                and not lines[3].lower().startswith("view job"):
            details['location'] = lines[3]
    else:
        details['role'] = extract_role("", " ".join(lines)[:800])

    match = re.search(r"View job:\s*(https://www\.linkedin\.com/\S+)", body or "")

    if match:
        # Drop the tracking codes after "?": the short link is enough.
        details['job_url'] = match.group(1).split("?")[0].replace("/comm/", "/")

    return details


def analyse_email(subject, sender, snippet):
    category = classify_email(subject, snippet)

    return {
        'category': category,
        'suggested_status': CATEGORY_STATUS[category],
        'suggested_company': extract_company(subject, snippet, sender),
        'suggested_role': extract_role(subject, snippet),
    }
