from app.security.passwords import hash_password, verify_password


def test_argon2_password_hashing():
    hashed = hash_password("StrongPassword123!")
    assert hashed.startswith("$argon2")
    assert verify_password("StrongPassword123!", hashed)
    assert not verify_password("wrong", hashed)
