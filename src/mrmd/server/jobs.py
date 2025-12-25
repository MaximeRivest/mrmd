"""
Background Job Manager for mrmd.

Manages background execution of AI commands and code cells,
with persistence across client disconnects.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
import json


class JobType(str, Enum):
    AI = "ai"
    CODE = "code"


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class Job:
    """Represents a background job."""
    id: str
    type: JobType
    status: JobStatus
    created_at: datetime
    request: Dict[str, Any]  # Original request parameters
    file_path: Optional[str] = None  # Associated file
    block_index: Optional[int] = None  # Code block index
    completed_at: Optional[datetime] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    # AI-specific fields
    program_name: Optional[str] = None
    juice_level: Optional[int] = None
    # Code-specific fields
    language: Optional[str] = None
    session_id: Optional[str] = None
    # Progress tracking
    progress: Optional[str] = None  # Optional progress message

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "type": self.type.value,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "request": self.request,
            "result": self.result,
            "error": self.error,
            "file_path": self.file_path,
            "block_index": self.block_index,
            "program_name": self.program_name,
            "juice_level": self.juice_level,
            "language": self.language,
            "session_id": self.session_id,
            "progress": self.progress,
        }


@dataclass
class Notification:
    """Represents a notification for a completed job."""
    id: str
    job_id: str
    type: str  # 'ai_complete', 'code_complete', 'error'
    title: str
    message: str
    created_at: datetime
    read: bool = False
    file_path: Optional[str] = None
    block_index: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "job_id": self.job_id,
            "type": self.type,
            "title": self.title,
            "message": self.message,
            "created_at": self.created_at.isoformat(),
            "read": self.read,
            "file_path": self.file_path,
            "block_index": self.block_index,
        }


class JobManager:
    """
    Manages background jobs for AI and code execution.

    Jobs persist in memory and survive client disconnects.
    Notifications are created when jobs complete.
    """

    def __init__(self):
        self.jobs: Dict[str, Job] = {}
        self.notifications: List[Notification] = []
        self._job_callbacks: Dict[str, Callable] = {}  # job_id -> completion callback
        self._max_notifications = 100  # Keep last N notifications
        self._max_completed_jobs = 50  # Keep last N completed jobs

    def create_job(
        self,
        job_type: JobType,
        request: Dict[str, Any],
        file_path: Optional[str] = None,
        block_index: Optional[int] = None,
        program_name: Optional[str] = None,
        juice_level: Optional[int] = None,
        language: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Job:
        """Create a new pending job."""
        job_id = str(uuid.uuid4())[:8]
        job = Job(
            id=job_id,
            type=job_type,
            status=JobStatus.PENDING,
            created_at=datetime.now(),
            request=request,
            file_path=file_path,
            block_index=block_index,
            program_name=program_name,
            juice_level=juice_level,
            language=language,
            session_id=session_id,
        )
        self.jobs[job_id] = job
        return job

    def start_job(self, job_id: str) -> Optional[Job]:
        """Mark a job as running."""
        job = self.jobs.get(job_id)
        if job and job.status == JobStatus.PENDING:
            job.status = JobStatus.RUNNING
            return job
        return None

    def complete_job(
        self,
        job_id: str,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ) -> Optional[Job]:
        """Mark a job as completed (success or error)."""
        job = self.jobs.get(job_id)
        if not job:
            return None

        job.completed_at = datetime.now()
        job.result = result
        job.error = error

        if error:
            job.status = JobStatus.ERROR
        else:
            job.status = JobStatus.COMPLETED

        # Create notification
        self._create_notification_for_job(job)

        # Cleanup old completed jobs
        self._cleanup_old_jobs()

        return job

    def cancel_job(self, job_id: str) -> Optional[Job]:
        """Cancel a pending or running job."""
        job = self.jobs.get(job_id)
        if job and job.status in (JobStatus.PENDING, JobStatus.RUNNING):
            job.status = JobStatus.CANCELLED
            job.completed_at = datetime.now()
            return job
        return None

    def update_progress(self, job_id: str, progress: str) -> Optional[Job]:
        """Update job progress message."""
        job = self.jobs.get(job_id)
        if job and job.status == JobStatus.RUNNING:
            job.progress = progress
            return job
        return None

    def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID."""
        return self.jobs.get(job_id)

    def list_jobs(
        self,
        status: Optional[JobStatus] = None,
        job_type: Optional[JobType] = None,
        file_path: Optional[str] = None,
    ) -> List[Job]:
        """List jobs with optional filters."""
        jobs = list(self.jobs.values())

        if status:
            jobs = [j for j in jobs if j.status == status]
        if job_type:
            jobs = [j for j in jobs if j.type == job_type]
        if file_path:
            jobs = [j for j in jobs if j.file_path == file_path]

        # Sort by created_at descending
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return jobs

    def get_running_jobs(self) -> List[Job]:
        """Get all currently running jobs."""
        return self.list_jobs(status=JobStatus.RUNNING)

    def get_pending_jobs(self) -> List[Job]:
        """Get all pending jobs."""
        return self.list_jobs(status=JobStatus.PENDING)

    def delete_job(self, job_id: str) -> bool:
        """Delete a job (only completed/cancelled/error jobs)."""
        job = self.jobs.get(job_id)
        if job and job.status in (JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.ERROR):
            del self.jobs[job_id]
            return True
        return False

    # ==================== Notifications ====================

    def _create_notification_for_job(self, job: Job):
        """Create a notification when a job completes."""
        if job.status == JobStatus.COMPLETED:
            if job.type == JobType.AI:
                notif_type = "ai_complete"
                title = f"AI: {job.program_name or 'Task'} completed"
                message = f"Result ready for {job.file_path or 'document'}"
            else:
                notif_type = "code_complete"
                title = f"Code execution completed"
                message = f"Block {job.block_index} in {job.file_path or 'document'}"
        elif job.status == JobStatus.ERROR:
            notif_type = "error"
            title = f"{'AI' if job.type == JobType.AI else 'Code'} failed"
            message = job.error or "Unknown error"
        else:
            return  # No notification for other statuses

        notification = Notification(
            id=str(uuid.uuid4())[:8],
            job_id=job.id,
            type=notif_type,
            title=title,
            message=message,
            created_at=datetime.now(),
            file_path=job.file_path,
            block_index=job.block_index,
        )
        self.notifications.append(notification)

        # Cleanup old notifications
        if len(self.notifications) > self._max_notifications:
            self.notifications = self.notifications[-self._max_notifications:]

    def get_notifications(
        self,
        since: Optional[datetime] = None,
        unread_only: bool = False
    ) -> List[Notification]:
        """Get notifications, optionally filtered."""
        notifs = self.notifications

        if since:
            notifs = [n for n in notifs if n.created_at > since]
        if unread_only:
            notifs = [n for n in notifs if not n.read]

        return notifs

    def mark_notification_read(self, notification_id: str) -> bool:
        """Mark a notification as read."""
        for notif in self.notifications:
            if notif.id == notification_id:
                notif.read = True
                return True
        return False

    def mark_all_notifications_read(self) -> int:
        """Mark all notifications as read. Returns count marked."""
        count = 0
        for notif in self.notifications:
            if not notif.read:
                notif.read = True
                count += 1
        return count

    def get_unread_count(self) -> int:
        """Get count of unread notifications."""
        return sum(1 for n in self.notifications if not n.read)

    def clear_notifications(self) -> int:
        """Clear all read notifications. Returns count cleared."""
        before = len(self.notifications)
        self.notifications = [n for n in self.notifications if not n.read]
        return before - len(self.notifications)

    def _cleanup_old_jobs(self):
        """Remove old completed jobs to prevent memory growth."""
        completed = [
            j for j in self.jobs.values()
            if j.status in (JobStatus.COMPLETED, JobStatus.ERROR, JobStatus.CANCELLED)
        ]
        completed.sort(key=lambda j: j.completed_at or j.created_at)

        while len(completed) > self._max_completed_jobs:
            old_job = completed.pop(0)
            del self.jobs[old_job.id]


# Global job manager instance
_job_manager: Optional[JobManager] = None


def get_job_manager() -> JobManager:
    """Get the global job manager instance."""
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager()
    return _job_manager
