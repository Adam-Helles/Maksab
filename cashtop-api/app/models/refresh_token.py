from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.base import TimestampMixin


class RefreshToken(Base, TimestampMixin):
    """
    سجل كل refresh token اتصدر — لازم عشان الـ rotation وكشف السرقة.

    ⚠️ expires_at مخزّن كـ UTC "ساذج" (naive، بدون tzinfo) عمداً — SQLite
    ما بيحافظ على معلومة الـ timezone بشكل موثوق، ومقارنة توقيت aware
    مع naive بترمي TypeError. لو انتقلنا لـ PostgreSQL بالإنتاج لاحقاً
    ممكن نرجع لـ timezone-aware، بس لازم نكون متسقين وقتها بكل مكان.
    """
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)

    # المعرّف الفريد المطمور جوا الـ JWT نفسه — هو مصدر الحقيقة للمطابقة
    jti = Column(String(36), unique=True, nullable=False, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    is_revoked = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime(timezone=False), nullable=False)

    # jti للتوكن الجديد يلي استبدل هاد الواحد (لتتبع سلسلة الـ rotation
    # عند التحقيق بحادثة أمنية لاحقاً)
    replaced_by = Column(String(36), nullable=True)

    user = relationship("User")

    def __repr__(self):
        return f"<RefreshToken jti={self.jti} user={self.user_id} revoked={self.is_revoked}>"