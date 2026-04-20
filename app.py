import json
import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import (
    init_db, get_all_progress, upsert_progress,
    get_best_quiz_attempt, save_quiz_attempt, log_time_session, get_stats
)

app = FastAPI(title="Math Companion")

BASE_DIR       = Path(__file__).parent
CURRICULUM_PATH = BASE_DIR / "curriculum.json"
STATIC_DIR     = BASE_DIR / "static"

# Load curriculum once at startup
with open(CURRICULUM_PATH) as f:
    CURRICULUM = json.load(f)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    """Health check — used by Render to confirm the service is live."""
    return {"status": "ok"}


# --- Static files ---
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def root():
    return FileResponse(str(STATIC_DIR / "index.html"))


# --- API ---

@app.get("/api/curriculum")
def get_curriculum():
    return CURRICULUM


@app.get("/api/progress")
def get_progress():
    return get_all_progress()


class ProgressUpdate(BaseModel):
    status: str


@app.post("/api/progress/{section_id}")
def update_progress(section_id: str, body: ProgressUpdate):
    allowed = {"not_started", "in_progress", "completed"}
    if body.status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of {allowed}")
    upsert_progress(section_id, body.status)
    return {"ok": True, "section_id": section_id, "status": body.status}


@app.get("/api/quiz/{quiz_id}/best")
def best_quiz(quiz_id: str):
    attempt = get_best_quiz_attempt(quiz_id)
    if not attempt:
        return {"attempted": False}
    return {"attempted": True, **attempt}


class QuizSubmission(BaseModel):
    answers: List[int]


def find_quiz(quiz_id: str):
    for exp in CURRICULUM["expeditions"]:
        for unit in exp.get("units", []):
            for section in unit.get("sections", []):
                if section["id"] == quiz_id and section["type"] == "quiz":
                    return section
    return None


@app.post("/api/quiz/{quiz_id}")
def submit_quiz(quiz_id: str, body: QuizSubmission):
    quiz = find_quiz(quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    questions = quiz["questions"]
    if len(body.answers) != len(questions):
        raise HTTPException(
            status_code=400,
            detail=f"Expected {len(questions)} answers, got {len(body.answers)}"
        )

    score = 0
    results = []
    for q, ans in zip(questions, body.answers):
        correct    = q["answer"]
        is_correct = ans == correct
        if is_correct:
            score += 1
        results.append({
            "submitted":   ans,
            "correct":     correct,
            "is_correct":  is_correct,
            "explanation": q.get("explanation", ""),
        })

    max_score = len(questions)
    save_quiz_attempt(quiz_id, score, max_score, json.dumps(body.answers))
    upsert_progress(quiz_id, "completed")

    return {"score": score, "max_score": max_score, "results": results}


class TimeLog(BaseModel):
    section_id: str
    seconds: int


@app.post("/api/time")
def log_time(body: TimeLog):
    if body.seconds > 0:
        log_time_session(body.section_id, body.seconds)
    return {"ok": True}


@app.get("/api/stats")
def api_stats():
    base = get_stats()
    total = 0
    estimated_total = 0
    for exp in CURRICULUM["expeditions"]:
        for unit in exp.get("units", []):
            total         += len(unit.get("sections", []))
            estimated_total += unit.get("estimatedMinutes", 0)
    base["total_sections"] = total
    completed_ratio = base["completed_sections"] / max(total, 1)
    base["estimated_remaining_seconds"] = int(estimated_total * 60 * (1 - completed_ratio))
    return base
