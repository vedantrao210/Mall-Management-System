"""FastAPI application entry point.

Run (development):
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Interactive API documentation is available at /api/docs.
If the React frontend has been built (frontend/dist), it is served from "/".
"""
import logging

import pymysql
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import connect_app
from .errors import mysql_exception_handler
from .routers import admin, auth, billing, reports, resources

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    description="REST API for a mall management database (MySQL). "
                "Authenticate with POST /api/auth/login and use the token as a Bearer header.",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_exception_handler(pymysql.err.MySQLError, mysql_exception_handler)

# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
app.include_router(auth.router)
app.include_router(auth.users)
for r in resources.routers:
    app.include_router(r)
for r in billing.routers:
    app.include_router(r)
app.include_router(reports.router)
app.include_router(admin.router)


@app.get("/api/health", tags=["System"], summary="API and database health check")
def health():
    try:
        conn = connect_app()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT VERSION() AS version")
                version = cur.fetchone()["version"]
        finally:
            conn.close()
        return {"status": "ok", "database": "up", "mysql_version": version}
    except pymysql.err.MySQLError as exc:
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "down",
                                                      "error": str(exc.args[-1])})


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(status_code=404, detail=f"API endpoint /api/{path} not found")


# ---------------------------------------------------------------------------
# Single-page frontend (served only when it has been built)
# ---------------------------------------------------------------------------
dist = settings.frontend_dist
if (dist / "index.html").is_file():
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"message": f"{settings.app_name} API is running. "
                           "Build the frontend (cd frontend && npm run build) or open /api/docs."}
