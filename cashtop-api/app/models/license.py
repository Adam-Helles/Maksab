from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class LicenseKey(Base, TimestampMixin):
    __tablename__ = "license_keys"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(50), unique=True, nullable=False, index=True)
    days_valid = Column(Integer, nullable=False)
    
    is_used = Column(Boolean, default=False, nullable=False)
    used_by_store_id = Column(Integer, ForeignKey("stores.id"), nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)

    store = relationship("Store")

    def __repr__(self):
        return f"<LicenseKey {self.key} days={self.days_valid} used={self.is_used}>"
