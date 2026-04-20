"""
Database layer — works with both local SQLite (dev) and Turso (production).

Set these environment variables for Turso (Render deployment):
  TURSO_DATABASE_URL  = libsql://your-db-name.turso.io
  TURSO_AUTH_TOKEN    = your-auth-token

If those vars are absent, falls back to a local progress.db file (local dev).
"""

import os
from datetime import datetime, date, timedelta

TURSO_URL   = os.environ.get("TURSO_DATABASE_URL", "")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")


def _get_conn():
    if TURSO_URL:
        import libsql_experimental as libsql  # pip install libsql-experimental
        return libsql.connect(TURSO_URL, auth_token=TURSO_TOKEN)
    else:
        import sqlite3
        db_path = os.path.join(os.path.dirname(__file__), "progress.db")
        conn = sqlite3.connect(db_path)
        return conn


def _rows(cursor):
    """Normalize rows to plain dicts — works with both sqlite3 and libsql."""
    if cursor.description is None:
        return []
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _one(cursor):
    if cursor.description is None:
        return None
    cols = [d[0] for d in cursor.description]
    row = cursor.fetchone()
    return dict(zip(cols, row)) if row else None


def init_db():
    conn = _get_conn()
    statements = [
        """CREATE TABLE IF NOT EXISTS section_progress (
            section_id TEXT PRIMARY KEY,
            status TEXT DEFAULT 'not_started',
            completed_at TEXT,
            time_spent_seconds INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS quiz_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quiz_id TEXT NOT NULL,
            score INTEGER NOT NULL,
            max_score INTEGER NOT NULL,
            answers TEXT NOT NULL,
            attempted_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS time_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL
        )""",
    ]
    for stmt in statements:
        conn.execute(stmt)
    conn.commit()
    conn.close()


def get_all_progress():
    conn = _get_conn()
    rows = _rows(conn.execute("SELECT * FROM section_progress"))
    conn.close()
    return {r["section_id"]: r for r in rows}


def upsert_progress(section_id: str, status: str):
    conn = _get_conn()
    completed_at = datetime.utcnow().isoformat() if status == "completed" else None
    conn.execute(
        """INSERT INTO section_progress (section_id, status, completed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(section_id) DO UPDATE SET
               status = excluded.status,
               completed_at = CASE WHEN excluded.status = 'completed'
                                   THEN excluded.completed_at
                                   ELSE section_progress.completed_at END""",
        (section_id, status, completed_at),
    )
    conn.commit()
    conn.close()


def get_best_quiz_attempt(quiz_id: str):
    conn = _get_conn()
    row = _one(conn.execute(
        "SELECT * FROM quiz_attempts WHERE quiz_id = ? ORDER BY score DESC LIMIT 1",
        (quiz_id,),
    ))
    conn.close()
    return row


def save_quiz_attempt(quiz_id: str, score: int, max_score: int, answers: str):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO quiz_attempts (quiz_id, score, max_score, answers, attempted_at) VALUES (?, ?, ?, ?, ?)",
        (quiz_id, score, max_score, answers, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def log_time_session(section_id: str, duration_seconds: int):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO time_sessions (section_id, started_at, duration_seconds) VALUES (?, ?, ?)",
        (section_id, datetime.utcnow().isoformat(), duration_seconds),
    )
    conn.execute(
        """INSERT INTO section_progress (section_id, time_spent_seconds)
           VALUES (?, ?)
           ON CONFLICT(section_id) DO UPDATE SET
               time_spent_seconds = section_progress.time_spent_seconds + excluded.time_spent_seconds""",
        (section_id, duration_seconds),
    )
    conn.commit()
    conn.close()


def get_stats():
    conn = _get_conn()
    row = _one(conn.execute(
        "SELECT COALESCE(SUM(duration_seconds), 0) as t FROM time_sessions"
    ))
    total_time = row["t"] if row else 0

    row = _one(conn.execute(
        "SELECT COUNT(*) as c FROM section_progress WHERE status = 'completed'"
    ))
    completed = row["c"] if row else 0

    day_rows = _rows(conn.execute(
        "SELECT DISTINCT date(started_at) as d FROM time_sessions ORDER BY d DESC"
    ))
    conn.close()

    streak = 0
    today = date.today()
    for i, r in enumerate(day_rows):
        if r["d"] == (today - timedelta(days=i)).isoformat():
            streak += 1
        else:
            break

    return {
        "total_time_seconds": total_time,
        "completed_sections": completed,
        "streak_days": streak,
    }
