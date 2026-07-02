from fastapi import APIRouter, Depends, HTTPException, Response

from app.core.auth import AUTH_COOKIE_NAME, AUTH_SESSION_SECONDS, authenticate, create_token, public_user, require_user


router = APIRouter()


@router.post("/login")
async def login(payload: dict, response: Response) -> dict:
    user = await authenticate(payload.get("username", ""), payload.get("password", ""))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token(user)
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        max_age=AUTH_SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
    )
    return {"user": public_user(user)}


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(AUTH_COOKIE_NAME)
    return {"detail": "Logged out"}


@router.get("/me")
async def me(user: dict = Depends(require_user)) -> dict:
    return {"user": user}
