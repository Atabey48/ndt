from __future__ import annotations

from sqlalchemy.orm import Session

from .auth import hash_password
from .models import Manufacturer, User


def seed_data(db: Session) -> None:
    if db.query(Manufacturer).count() == 0:
        db.add_all(
            [
                Manufacturer(name="Boeing", theme_primary="#0b3d91", theme_secondary="#dce7f7"),
                Manufacturer(name="Airbus", theme_primary="#00205b", theme_secondary="#e5eef9"),
                Manufacturer(name="Other", theme_primary="#2f855a", theme_secondary="#e6fffa"),
            ]
        )

    if db.query(User).count() == 0:
        db.add_all(
            [
                User(
                    username="admin",
                    password_hash=hash_password("admin123"),
                    role="admin",
                    is_active=True,
                ),
                User(
                    username="user",
                    password_hash=hash_password("user123"),
                    role="user",
                    is_active=True,
                ),
            ]
        )
    db.commit()