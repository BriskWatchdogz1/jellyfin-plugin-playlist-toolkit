#!/usr/bin/env python3
"""Creates demo playlists for manual and browser tests (owner: alice). Prints their ids."""
import jf


def main():
    alice = jf.login("alice")
    items = alice.get("/Items", params={"IncludeItemTypes": "Audio", "Recursive": "true", "UserId": alice.user_id,
                                        "SortBy": "SortName", "Limit": "5000", "Fields": "Path"}).json()["Items"]
    small = [i["Id"] for i in items if "/small/" in i["Path"]]
    bulk = [i["Id"] for i in items if "/bulk/" in i["Path"]]
    existing = {p["Name"]: p["Id"] for p in alice.get("/Items", params={"IncludeItemTypes": "Playlist", "Recursive": "true", "UserId": alice.user_id}).json()["Items"]}
    by_artist = {}
    for item in items:
        if "/small/" in item["Path"]:
            by_artist.setdefault(item["Path"].split("/small/")[1].split("/")[0], []).append(item["Id"])
    tiny = [track for tracks in list(by_artist.values())[:4] for track in tracks[:2]]  # 4 artists, 2 tracks each
    for name, ids in (("Demo Small", small[:24]), ("Demo Big", bulk[:2500]), ("Demo Tiny", tiny)):
        if name not in existing:
            resp = alice.post("/Playlists", {"Name": name, "Ids": ids, "UserId": alice.user_id, "MediaType": "Audio", "IsPublic": False})
            existing[name] = resp.json()["Id"]
        print(name, existing[name])


if __name__ == "__main__":
    main()
