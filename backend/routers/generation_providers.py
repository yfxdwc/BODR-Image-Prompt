from fastapi import APIRouter, Depends, HTTPException, Request
from backend.auth.deps import require_admin, require_user
from pydantic import BaseModel

from backend.services.openai_codex_native import CodexDeviceCodeFlow, CodexNativeAuthError, CodexNativeAuthStore

router = APIRouter(prefix="/generation-providers", tags=["generation-providers"])


class CodexNativePollRequest(BaseModel):
    device_auth_id: str
    user_code: str


@router.get("")
def list_generation_providers(request: Request):
    del request
    return [
        {
            "provider": "manual_upload",
            "display_name": "Manual upload",
            "optional": False,
            "configured": True,
            "authenticated": True,
            "available": True,
            "state": "available",
            "reason": None,
            "features": {
                "text_to_image": False,
                "text_reference_to_image": False,
                "image_edit": False,
                "manual_result_upload": True,
            },
        },
        CodexNativeAuthStore().status(),
    ]


@router.get("/openai-codex-native/status", dependencies=[Depends(require_user)])
def openai_codex_native_status(request: Request):
    del request
    return CodexNativeAuthStore().status()


@router.post("/openai-codex-native/auth/start", dependencies=[Depends(require_admin)])
def openai_codex_native_auth_start(request: Request):
    del request
    try:
        return CodexDeviceCodeFlow().start()
    except CodexNativeAuthError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/openai-codex-native/auth/poll", dependencies=[Depends(require_admin)])
def openai_codex_native_auth_poll(payload: CodexNativePollRequest, request: Request):
    del request
    try:
        return CodexDeviceCodeFlow().poll_device_authorization(payload.device_auth_id, payload.user_code)
    except CodexNativeAuthError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/openai-codex-native/auth/disconnect", dependencies=[Depends(require_admin)])
def openai_codex_native_auth_disconnect(request: Request):
    del request
    store = CodexNativeAuthStore()
    store.delete_tokens()
    return store.status()
