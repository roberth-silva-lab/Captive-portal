from app.security.passwords import hash_password, verify_password


def test_argon2_password_hashing():
    hashed = hash_password("VeryStrongPassword123")
    assert hashed != "VeryStrongPassword123"
    assert verify_password("VeryStrongPassword123", hashed)
    assert not verify_password("wrong", hashed)
