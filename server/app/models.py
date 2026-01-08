from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Manufacturer(Base):
    __tablename__ = "manufacturers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    theme_primary: Mapped[str | None] = mapped_column(String(20))
    theme_secondary: Mapped[str | None] = mapped_column(String(20))

    documents = relationship("Document", back_populates="manufacturer")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    documents_uploaded = relationship("Document", back_populates="uploaded_by_user")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    manufacturer_id: Mapped[int] = mapped_column(ForeignKey("manufacturers.id"))
    title: Mapped[str] = mapped_column(String(255))
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(255))
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    revision_date: Mapped[str | None] = mapped_column(String(50))
    tags: Mapped[str | None] = mapped_column(Text)

    manufacturer = relationship("Manufacturer", back_populates="documents")
    uploaded_by_user = relationship("User", back_populates="documents_uploaded")
    sections = relationship("Section", back_populates="document", cascade="all, delete-orphan")
    figures = relationship("Figure", back_populates="document", cascade="all, delete-orphan")


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"))
    heading_text: Mapped[str] = mapped_column(String(255))
    heading_level: Mapped[str] = mapped_column(String(20))
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    order_index: Mapped[int] = mapped_column(Integer)

    document = relationship("Document", back_populates="sections")
    figures = relationship("Figure", back_populates="section", cascade="all, delete-orphan")


class Figure(Base):
    __tablename__ = "figures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"))
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id"))
    page_number: Mapped[int | None] = mapped_column(Integer)
    caption_text: Mapped[str | None] = mapped_column(String(255))
    image_storage_key: Mapped[str | None] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer)

    document = relationship("Document", back_populates="figures")
    section = relationship("Section", back_populates="figures")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20))
    action_type: Mapped[str] = mapped_column(String(50))
    manufacturer_id: Mapped[int | None] = mapped_column(Integer)
    document_id: Mapped[int | None] = mapped_column(Integer)
    section_id: Mapped[int | None] = mapped_column(Integer)
    metadata_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SessionToken(Base):
    __tablename__ = "session_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    token: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
