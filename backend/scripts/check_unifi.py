import asyncio

from app.core.config import get_settings
from app.integrations.unifi.client import UniFiError, unifi_client


async def main() -> int:
    settings = get_settings()
    print(f"Modo UniFi: {settings.normalized_unifi_auth_mode}")
    print(f"Controlador: {settings.unifi_base_url}")
    try:
        sites = await unifi_client.list_sites()
        print(f"Sites visíveis: {len(sites)}")
        for site in sites:
            site_id = str(site.get("id") or "")
            site_name = str(site.get("name") or site_id)
            clients = await unifi_client.list_clients(site_id)
            access_points = await unifi_client.list_access_points(site_id)
            authorized = sum(
                1
                for row in clients
                if bool(row.get("authorized") if "authorized" in row else (row.get("access") or {}).get("authorized"))
            )
            print(
                f"- {site_name} [{site_id}]: "
                f"{len(access_points)} AP(s), {len(clients)} cliente(s), {authorized} autorizado(s)"
            )
        print("UniFi OK")
        return 0
    except UniFiError as exc:
        print(f"UniFi ERRO: {exc}")
        return 1
    finally:
        await unifi_client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
