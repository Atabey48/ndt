from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ManufacturerOut(BaseModel):
    id: int
    name: str
    theme_primary: Optional[str]
    theme_secondary: Optional[str]

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class DocumentOut(BaseModel):
    id: int
    manufacturer_id: int
    title: str
    original_filename: str
    storage_key: str
    uploaded_by: int
    uploaded_at: datetime
    revision_date: Optional[str]
    tags: Optional[str]

    class Config:
        from_attributes = True


class SectionOut(BaseModel):
    id: int
    document_id: int
    heading_text: str
    heading_level: str
    page_start: Optional[int]
    page_end: Optional[int]
    order_index: int

    class Config:
        from_attributes = True


class FigureOut(BaseModel):
    id: int
    document_id: int
    section_id: Optional[int]
    page_number: Optional[int]
    caption_text: Optional[str]
    image_storage_key: Optional[str]
    order_index: int

    class Config:
        from_attributes = True


class AuditLogOut(BaseModel):
    id: int
    user_id: int
    role: str
    action_type: str
    manufacturer_id: Optional[int]
    document_id: Optional[int]
    section_id: Optional[int]
    metadata_json: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class SearchRequest(BaseModel):
    query: str


class SearchResult(BaseModel):
    title: str
    description: str
    features: List[str]
    source: str
    link: str


class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
