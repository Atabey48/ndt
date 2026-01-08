from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .auth import create_token, get_current_user, require_admin, verify_password
from .db import Base, engine, get_session
from .models import AuditLog, Document, Figure, Manufacturer, Section, SessionToken, User
from .pdf_parser import parse_pdf
from .schemas import (
    AuditLogOut,
    DocumentOut,
    LoginRequest,
    LoginResponse,
    ManufacturerOut,
    SearchRequest,
    SearchResponse,
    SectionOut,
    FigureOut,
    UserOut,
)
from .search_tool import run_search
from .seed import seed_data
from .storage import save_pdf

app = FastAPI(title="NDT Document Hub")

WEB_ROOT = Path(__file__).resolve().parents[2] / "web"
app.mount("/static", StaticFiles(directory=WEB_ROOT, html=False), name="static")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    with next(get_session()) as db:
        seed_data(db)


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_session)) -> LoginResponse:
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User inactive")

    token_value = create_token()
    token = SessionToken(user_id=user.id, token=token_value)
    db.add(token)
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="LOGIN",
            metadata_json=json.dumps({"username": user.username}),
            created_at=datetime.utcnow(),
        )
    )
    db.commit()
    return LoginResponse(token=token_value, user=UserOut.model_validate(user))


@app.post("/api/auth/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_session)) -> dict:
    db.query(SessionToken).filter(SessionToken.user_id == user.id).delete()
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="LOGOUT",
            metadata_json=json.dumps({"username": user.username}),
            created_at=datetime.utcnow(),
        )
    )
    db.commit()
    return {"status": "ok"}


@app.get("/api/manufacturers", response_model=list[ManufacturerOut])
def list_manufacturers(db: Session = Depends(get_session)) -> list[ManufacturerOut]:
    return db.query(Manufacturer).all()


@app.get("/api/manufacturers/{manufacturer_id}/documents", response_model=list[DocumentOut])
def list_documents(
    manufacturer_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[DocumentOut]:
    documents = (
        db.query(Document).filter(Document.manufacturer_id == manufacturer_id).order_by(Document.uploaded_at.desc()).all()
    )
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="VIEW_DOC_LIST",
            manufacturer_id=manufacturer_id,
            metadata_json=json.dumps({"count": len(documents)}),
        )
    )
    db.commit()
    return documents


@app.post("/api/manufacturers/{manufacturer_id}/documents", response_model=DocumentOut)
async def upload_document(
    manufacturer_id: int,
    title: str = Form(...),
    revision_date: str | None = Form(None),
    tags: str | None = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(require_admin),
    db: Session = Depends(get_session),
) -> DocumentOut:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    temp_path = Path("server/storage/tmp")
    temp_path.mkdir(parents=True, exist_ok=True)
    temp_file = temp_path / file.filename
    with temp_file.open("wb") as buffer:
        buffer.write(await file.read())

    storage_key = save_pdf(temp_file, file.filename)
    sections, figures = parse_pdf(temp_file)

    document = Document(
        manufacturer_id=manufacturer_id,
        title=title,
        original_filename=file.filename,
        storage_key=storage_key,
        uploaded_by=user.id,
        revision_date=revision_date,
        tags=tags,
    )
    db.add(document)
    db.flush()

    section_models: list[Section] = []
    for parsed in sections:
        section_models.append(
            Section(
                document_id=document.id,
                heading_text=parsed.heading_text,
                heading_level=parsed.heading_level,
                page_start=parsed.page_start,
                page_end=parsed.page_end,
                order_index=parsed.order_index,
            )
        )
    db.add_all(section_models)
    db.flush()

    figure_models: list[Figure] = []
    for parsed in figures:
        section_id = None
        if parsed.section_index is not None and parsed.section_index < len(section_models):
            section_id = section_models[parsed.section_index].id
        figure_models.append(
            Figure(
                document_id=document.id,
                section_id=section_id,
                page_number=parsed.page_number,
                caption_text=parsed.caption_text,
                image_storage_key=None,
                order_index=parsed.order_index,
            )
        )
    db.add_all(figure_models)

    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="UPLOAD_DOC",
            manufacturer_id=manufacturer_id,
            document_id=document.id,
            metadata_json=json.dumps({"sections": len(section_models), "figures": len(figure_models)}),
        )
    )
    db.commit()
    return DocumentOut.model_validate(document)


@app.patch("/api/documents/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: int,
    title: str | None = Form(None),
    revision_date: str | None = Form(None),
    tags: str | None = Form(None),
    user: User = Depends(require_admin),
    db: Session = Depends(get_session),
) -> DocumentOut:
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if title:
        document.title = title
    if revision_date:
        document.revision_date = revision_date
    if tags:
        document.tags = tags

    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="UPDATE_DOC",
            document_id=document.id,
            metadata_json=json.dumps({"title": title, "revision_date": revision_date}),
        )
    )
    db.commit()
    return DocumentOut.model_validate(document)


@app.delete("/api/documents/{document_id}")
def delete_document(
    document_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict:
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(document)
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="DELETE_DOC",
            document_id=document_id,
        )
    )
    db.commit()
    return {"status": "deleted"}


@app.get("/api/documents/{document_id}/sections", response_model=list[SectionOut])
def list_sections(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[SectionOut]:
    sections = db.query(Section).filter(Section.document_id == document_id).order_by(Section.order_index).all()
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="VIEW_SECTION_LIST",
            document_id=document_id,
            metadata_json=json.dumps({"count": len(sections)}),
        )
    )
    db.commit()
    return sections


@app.get("/api/sections/{section_id}/figures", response_model=list[FigureOut])
def list_figures(
    section_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[FigureOut]:
    figures = db.query(Figure).filter(Figure.section_id == section_id).order_by(Figure.order_index).all()
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="VIEW_SECTION",
            section_id=section_id,
            metadata_json=json.dumps({"count": len(figures)}),
        )
    )
    db.commit()
    return figures


@app.get("/api/documents/{document_id}/pdf")
def get_document_pdf(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> FileResponse:
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    file_path = Path("server/storage") / document.storage_key
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="PDF missing")
    return FileResponse(path=file_path, filename=document.original_filename, media_type="application/pdf")


@app.get("/api/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(
    user: User = Depends(require_admin),
    db: Session = Depends(get_session),
) -> list[AuditLogOut]:
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all()
    return logs


@app.post("/api/tool/search", response_model=SearchResponse)
async def search_tool(
    payload: SearchRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> SearchResponse:
    results = await run_search(payload.query)
    db.add(
        AuditLog(
            user_id=user.id,
            role=user.role,
            action_type="SEARCH_TOOL",
            metadata_json=json.dumps({"query": payload.query, "count": len(results)}),
        )
    )
    db.commit()
    return SearchResponse(query=payload.query, results=results)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/app", include_in_schema=False)
def app_entry() -> HTMLResponse:
    index_path = WEB_ROOT / "index.html"
    return HTMLResponse(index_path.read_text(encoding="utf-8"))