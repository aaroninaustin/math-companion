# The Expedition — Math Companion

A companion app for your personalized math curriculum.

## Setup

1. Install dependencies:
   ```
   pip install fastapi "uvicorn[standard]"
   ```

2. Run the app:
   ```
   uvicorn app:app --reload --port 8080
   ```

3. Open your browser to:
   http://localhost:8080

Your progress is automatically saved in `progress.db`.
