#!/usr/bin/env python3
"""End-to-end API tests against the local test server.

Everything is exercised as a normal (non-admin) playlist owner; the negative cases use
other normal users and the administrator. Run after setup.py:

    python3 testserver/test_api.py
"""
import collections
import datetime
import subprocess
import sys
import tempfile
import time
import urllib.parse

import jf
import wsclient

RESULTS = []
PLUGIN_ID = "fd26499be4c14a7d8648a898f06e647b"


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print(("PASS  " if condition else "FAIL  ") + name + (f"   [{detail}]" if detail else ""))


def make_image(fmt, size=64, color="red"):
    with tempfile.TemporaryDirectory() as tmp:
        path = f"{tmp}/img.{fmt}"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color={color}:size={size}x{size}", "-frames:v", "1", path], check=True)
        with open(path, "rb") as handle:
            return handle.read()


def audio_items(client, **params):
    query = {"IncludeItemTypes": "Audio", "Recursive": "true", "UserId": client.user_id, "SortBy": "SortName", "Limit": "5000", "Fields": "Path"}
    query.update(params)
    return client.get("/Items", params=query).json()["Items"]


def create_playlist(client, name, ids, public=False):
    resp = client.post("/Playlists", {"Name": name, "Ids": ids, "UserId": client.user_id, "MediaType": "Audio", "IsPublic": public})
    assert resp.status == 200, resp.text()
    return resp.json()["Id"]


def delete_test_playlists(clients):
    for client in clients:
        for item in client.get("/Items", params={"IncludeItemTypes": "Playlist", "Recursive": "true", "UserId": client.user_id}).json()["Items"]:
            if item["Name"].startswith("T-"):
                client.delete(f"/Items/{item['Id']}")


def wait_until(predicate, timeout=30, step=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return False


def main():
    alice, bob, carol, dave, admin = (jf.login(n) for n in ("alice", "bob", "carol", "dave", "testadmin"))
    anon = jf.Client()
    delete_test_playlists([alice, bob, carol, dave, admin])

    small = [i for i in audio_items(alice) if "/small/" in i["Path"]]
    bulk = [i for i in audio_items(alice) if "/bulk/" in i["Path"]]
    check("test library present", len(small) == 49 and len(bulk) >= 2500, f"small={len(small)} bulk={len(bulk)}")
    me = alice.get("/Users/Me").json()
    check("owner under test is not an administrator", me["Policy"]["IsAdministrator"] is False)

    # ---------------------------------------------------------------- script injection
    index = anon.get("/web/index.html")
    check("index.html carries the script tag", index.status == 200 and index.text().count("data-playlisttoolkit") == 1)
    check("index.html is not cached without revalidation", index.headers.get("Cache-Control") == "no-cache" and "ETag" not in index.headers)
    compressed = anon.get("/web/", headers={"Accept-Encoding": "gzip, br"})
    check("injection also works when the browser accepts compression", "data-playlisttoolkit" in compressed.text())
    conditional = anon.get("/web/index.html", headers={"If-Modified-Since": "Wed, 18 Nov 2026 00:00:00 GMT"})
    check("conditional request still returns the injected document", conditional.status == 200 and "data-playlisttoolkit" in conditional.text())
    script = anon.get("/PlaylistToolkit/ClientScript")
    check("client script is served without login", script.status == 200 and "javascript" in script.headers.get("Content-Type", ""))
    other = anon.get("/web/manifest.json")
    check("other web files are untouched", other.status == 200 and "playlisttoolkit" not in other.text())
    check("API needs a login", anon.get("/PlaylistToolkit/Config").status == 401)

    # ---------------------------------------------------------------- plugin settings
    settings = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()
    check("normal user cannot read or change the plugin settings",
          alice.get(f"/Plugins/{PLUGIN_ID}/Configuration").status == 403
          and alice.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(settings, EditorsCanEditDetails=True)).status == 403)
    try:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(settings, InjectClientScript=False, EnableTrackTable=False))
        check("script injection can be switched off", "data-playlisttoolkit" not in anon.get("/web/index.html").text())
        check("track table switch reaches the client", alice.get("/PlaylistToolkit/Config").json()["EnableTrackTable"] is False)
    finally:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", settings)
    check("settings restored", "data-playlisttoolkit" in anon.get("/web/index.html").text())

    # ---------------------------------------------------------------- playlist under test
    ids = [i["Id"] for i in small[:12]]
    pid = create_playlist(alice, "T-Owner", ids)
    info = alice.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    check("owner sees own private playlist with full rights",
          info["IsOwner"] and info["CanManage"] and info["CanShare"] and info["CanEditItems"] and not info["OpenAccess"], str(info))
    check("other user cannot see a private playlist", bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    check("a normal user the playlist is not shared with cannot see it", dave.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    admin_private = admin.get(f"/PlaylistToolkit/Playlists/{pid}")
    check("administrator reaches a private playlist of another user with all rights (stock API hides it from them)",
          admin_private.status == 200 and admin.get(f"/Playlists/{pid}").status == 404
          and all(admin_private.json()[k] for k in ("CanEditItems", "CanManage", "CanShare")) and not admin_private.json()["IsOwner"],
          admin_private.text()[:200])
    check("unknown playlist id gives 404", alice.get("/PlaylistToolkit/Playlists/00000000000000000000000000000001").status == 404)

    # ---------------------------------------------------------------- 1. image
    png, jpg = make_image("png"), make_image("jpg", color="blue")
    stock = alice.post(f"/Items/{pid}/Images/Primary", raw=png, content_type="image/png")
    check("stock image upload is refused for the owner (the gap this plugin closes)", stock.status == 403, f"status {stock.status}")
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png")
    check("owner sets playlist image (png)", resp.status == 204, f"status {resp.status} {resp.text()[:100]}")
    served = alice.get(f"/Items/{pid}/Images/Primary", params={"format": "Png"})
    check("image is served by the stock image endpoint", served.status == 200 and served.headers.get("Content-Type", "").startswith("image/"))
    tag1 = alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json().get("ImageTags", {}).get("Primary")
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=jpg, content_type="image/jpeg")
    tag2 = alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json().get("ImageTags", {}).get("Primary")
    check("owner replaces playlist image (jpeg)", resp.status == 204 and tag1 and tag2 and tag1 != tag2, f"{tag1} -> {tag2}")
    check("wrong content type is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="text/plain").status in (400, 415))
    check("non-image body is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=b"x" * 500, content_type="image/png").status == 400)
    limit = alice.get("/PlaylistToolkit/Config").json()["MaxImageBytes"]
    too_big = png + b"\0" * (limit + 1 - len(png))
    check("oversized image is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=too_big, content_type="image/png").status == 413)
    check("user without access cannot set the image", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png").status == 404)

    # ---------------------------------------------------------------- 6. description
    text = "Quiet songs for the evening.\nSecond line with umlauts: äöü ß."
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": text})
    check("owner sets description", resp.status == 204, f"status {resp.status}")
    check("description is visible through the stock item API",
          alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json().get("Overview") == text)
    check("user without access cannot set the description", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 404)
    max_len = alice.get("/PlaylistToolkit/Config").json()["MaxDescriptionLength"]
    check("overlong description is rejected", alice.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x" * (max_len + 1)}).status == 400)

    # Adding a track makes Jellyfin refresh the playlist metadata; image and description must survive.
    alice.post(f"/Playlists/{pid}/Items", params={"ids": small[20]["Id"], "userId": alice.user_id})
    time.sleep(6)
    after = alice.get(f"/Items/{pid}", params={"UserId": alice.user_id}).json()
    check("image and description survive a metadata refresh",
          after.get("Overview") == text and after.get("ImageTags", {}).get("Primary") == tag2, f"overview ok={after.get('Overview') == text}")

    # ---------------------------------------------------------------- 3. sharing
    stock_share = alice.post(f"/Playlists/{pid}/Users/{bob.user_id}", {"CanEdit": False})
    print(f"INFO  stock share endpoint on a private playlist answers {stock_share.status} (jellyfin#18534 expects 500)")
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": [
        {"UserId": bob.user_id, "CanEdit": False}, {"UserId": carol.user_id, "CanEdit": True}]})
    shared = resp.json() if resp.status == 200 else {}
    check("owner shares a private playlist with two users", resp.status == 200 and len(shared.get("Shares", [])) == 2 and not shared.get("OpenAccess"), resp.text()[:200])
    bob_info = bob.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    carol_info = carol.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    check("listen-only user: sees it, may not edit, manage or share",
          not bob_info["CanEditItems"] and not bob_info["CanManage"] and not bob_info["CanShare"] and bob_info["Shares"] == [])
    check("editor: may edit tracks, may not manage or share (default setting)",
          carol_info["CanEditItems"] and not carol_info["CanManage"] and not carol_info["CanShare"])
    check("listen-only user can read tracks through the stock API", bob.get(f"/Playlists/{pid}/Items", params={"userId": bob.user_id}).status == 200)
    check("listen-only user cannot add tracks through the stock API",
          bob.post(f"/Playlists/{pid}/Items", params={"ids": small[30]["Id"], "userId": bob.user_id}).status == 403)
    check("editor can add tracks through the stock API",
          carol.post(f"/Playlists/{pid}/Items", params={"ids": small[30]["Id"], "userId": carol.user_id}).status == 204)
    time.sleep(6)  # the add above triggered a metadata refresh
    check("shares survive a metadata refresh",
          bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 200 and carol.get(f"/PlaylistToolkit/Playlists/{pid}").json()["CanEditItems"]
          and len(alice.get(f"/PlaylistToolkit/Playlists/{pid}").json()["Shares"]) == 2)
    check("shared playlist is still invisible to users it is not shared with", dave.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    check("listen-only user cannot change sharing", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": []}).status == 403)
    check("editor cannot change sharing", carol.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True}).status == 403)
    check("listen-only user cannot set image", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png").status == 403)
    check("editor cannot set image (default setting)", carol.post(f"/PlaylistToolkit/Playlists/{pid}/Image", raw=png, content_type="image/png").status == 403)
    check("listen-only user cannot set description", bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 403)
    check("listen-only user cannot delete image", bob.delete(f"/PlaylistToolkit/Playlists/{pid}/Image").status == 403)
    try:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", dict(settings, EditorsCanEditDetails=True))
        check("with the setting on, an editor may set the description but still not share",
              carol.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": text}).status == 204
              and carol.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True}).status == 403
              and bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 403)
    finally:
        admin.post(f"/Plugins/{PLUGIN_ID}/Configuration", settings)
    check("unknown user in share list is rejected",
          alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": [{"UserId": "00000000000000000000000000000009", "CanEdit": False}]}).status == 400)
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": [{"UserId": carol.user_id, "CanEdit": False}]})
    check("owner removes a user and downgrades another",
          resp.status == 200 and bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404
          and not carol.get(f"/PlaylistToolkit/Playlists/{pid}").json()["CanEditItems"])
    resp = alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True})
    check("owner makes the playlist public; shares are kept",
          resp.status == 200 and resp.json()["OpenAccess"] and len(resp.json()["Shares"]) == 1 and bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 200)
    alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": False, "Shares": []})
    check("owner makes it private again", bob.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404 and carol.get(f"/PlaylistToolkit/Playlists/{pid}").status == 404)
    users = alice.get("/PlaylistToolkit/Users").json()
    check("normal user gets the list of users to share with (hidden users included, self excluded)",
          sorted(u["Name"] for u in users) == ["bob", "carol", "dave", "testadmin"])
    check("user list exposes only id and name", all(set(u) == {"Id", "Name"} for u in users))
    # Jellyfin 12.4.0 hands the full stock user list (including each user's policy) to normal users, so
    # "normal users cannot list users" does not hold there. The plugin's list must never expose more than that.
    stock_users = alice.get("/Users")
    print(f"INFO  stock user list for a normal user answers {stock_users.status}")
    stock_fields = set().union(*(set(u) for u in stock_users.json())) if stock_users.status == 200 else set()
    check("the plugin's user list exposes nothing the stock API hides from a normal user",
          stock_users.status == 200 and {"Id", "Name"} <= stock_fields and {u["Id"] for u in users} <= {u["Id"] for u in stock_users.json()},
          "" if stock_users.status == 200 else
          f"stock /Users answers {stock_users.status}: this Jellyfin hides the user list from normal users, so /PlaylistToolkit/Users now shows more than stock - decide whether that is wanted")

    # ---------------------------------------------------------------- library access (carol may not use "Private Music")
    private = [i for i in audio_items(alice) if "/music-private/" in i["Path"]]
    private_ids = {i["Id"] for i in private}
    check("restricted test setup: the private library exists and is hidden from carol in stock browsing",
          len(private) == 7 and not any("/music-private/" in i["Path"] for i in audio_items(carol)), f"private={len(private)}")
    twin_open = next(i for i in small if i["Name"] == "Amber Song 12")
    twin_private = next(i for i in private if i["Name"] == "Amber Song 12")
    open_two = [i["Id"] for i in small if i["Name"] in ("Dusty Song 11", "Echo Song 11")]
    rid = create_playlist(alice, "T-Restricted", open_two + [i["Id"] for i in private])
    alice.post(f"/PlaylistToolkit/Playlists/{rid}/Sharing", {"Shares": [{"UserId": carol.user_id, "CanEdit": True}, {"UserId": bob.user_id, "CanEdit": False}]})
    rows_of = lambda client: [r["Id"] for r in client.get(f"/PlaylistToolkit/Playlists/{rid}/Items").json()["Items"]]
    check("owner and unrestricted user see all tracks of the shared playlist", len(rows_of(alice)) == 9 and len(rows_of(bob)) == 9)
    check("restricted user sees only tracks from libraries she may access", rows_of(carol) == open_two, f"{len(rows_of(carol))} rows")
    stock_carol = carol.get(f"/Playlists/{rid}/Items", params={"userId": carol.user_id}).json()
    print(f"INFO  stock playlist endpoint shows the restricted user {stock_carol['TotalRecordCount']} of 9 tracks")
    check("restricted user: smart shuffle contains no hidden track",
          sorted(carol.get(f"/PlaylistToolkit/Playlists/{rid}/SmartShuffle").json()["ItemIds"]) == sorted(open_two))
    carol_m3u = carol.get(f"/PlaylistToolkit/Playlists/{rid}/Export").text()
    check("restricted user: export contains no hidden track or path",
          carol_m3u.count("#EXTINF:") == 2 and not any(word in carol_m3u for word in ("music-private", "Secret", "Private Album")))
    resp = carol.post(f"/PlaylistToolkit/Playlists/{rid}/Duplicates", {"Ids": [twin_open["Id"], private[0]["Id"], twin_private["Id"]]})
    result = resp.json()
    check("restricted user: duplicate check neither expands hidden ids nor reports hidden entries",
          result["Total"] == 1 and result["Duplicates"] == [] and result["NewIds"] == [twin_open["Id"]]
          and not any(word in resp.text() for word in ("Secret", "Private Album")), resp.text()[:200])
    result = alice.post(f"/PlaylistToolkit/Playlists/{rid}/Duplicates", {"Ids": [twin_open["Id"]]}).json()
    check("the owner (with access) does get the 'similar' hint for the same song",
          [(d["Kind"], d["ExistingAlbum"]) for d in result["Duplicates"]] == [("similar", "Private Album")], str(result)[:200])
    secret_new = next(i for i in audio_items(alice) if i["Id"] in private_ids)
    resp = carol.post(f"/PlaylistToolkit/Playlists/{rid}/Items", {"Ids": [secret_new["Id"]]})
    check("restricted editor cannot add a hidden track by its id", resp.status == 200 and resp.json()["Added"] == 0 and len(rows_of(alice)) == 9, resp.text())
    resp = carol.post("/PlaylistToolkit/Import", {"Name": "T-Carol", "Content": "#EXTM3U\n#EXTINF:3,Secret Stag - Secret Song 1\n" + private[0]["Path"] + "\n"})
    check("restricted user: M3U import does not match hidden tracks", resp.status == 200 and resp.json()["Matched"] == 0, resp.text()[:200])

    # ---------------------------------------------------------------- administrator: everything, on every playlist
    aid = create_playlist(alice, "T-AdminTarget", [i["Id"] for i in small[:5]])
    listing = admin.get("/PlaylistToolkit/Admin/Playlists")
    entry = next((p for p in listing.json() if p["Id"] == aid), None) if listing.status == 200 else None
    check("administrator lists all playlists including private ones, with owner",
          entry is not None and entry["OwnerName"] == "alice" and not entry["OpenAccess"] and entry["ItemCount"] == 5 and entry["ShareCount"] == 0, str(entry))
    check("the list of all playlists is for administrators only",
          alice.get("/PlaylistToolkit/Admin/Playlists").status == 403 and anon.get("/PlaylistToolkit/Admin/Playlists").status == 401)
    check("client settings tell who is an administrator",
          admin.get("/PlaylistToolkit/Config").json()["IsAdministrator"] is True and alice.get("/PlaylistToolkit/Config").json()["IsAdministrator"] is False)
    check("administrator sets description and image of a private playlist of another user",
          admin.post(f"/PlaylistToolkit/Playlists/{aid}/Description", {"Overview": "set by admin"}).status == 204
          and admin.post(f"/PlaylistToolkit/Playlists/{aid}/Image", raw=png, content_type="image/png").status == 204
          and alice.get(f"/Items/{aid}", params={"UserId": alice.user_id}).json().get("Overview") == "set by admin"
          and alice.get(f"/PlaylistToolkit/Playlists/{aid}").json()["HasImage"])
    resp = admin.post(f"/PlaylistToolkit/Playlists/{aid}/Sharing", {"Shares": [{"UserId": bob.user_id, "CanEdit": False}]})
    check("administrator shares a private playlist of another user; the owner stays the owner",
          resp.status == 200 and bob.get(f"/PlaylistToolkit/Playlists/{aid}").status == 200
          and alice.get(f"/PlaylistToolkit/Playlists/{aid}").json()["IsOwner"] and resp.json()["OwnerName"] == "alice")
    admin_rows = lambda: admin.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]
    before = [r["Id"] for r in admin_rows()]
    resp = admin.post(f"/PlaylistToolkit/Playlists/{aid}/Items", {"Ids": [small[10]["Id"]]})
    check("administrator adds a track to a private playlist of another user",
          resp.status == 200 and resp.json()["Added"] == 1 and [r["Id"] for r in admin_rows()] == before + [small[10]["Id"]])
    last = admin_rows()[-1]
    resp = admin.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{last['PlaylistItemId']}/Move/0")
    check("administrator moves a track", resp.status == 204 and [r["Id"] for r in admin_rows()] == [small[10]["Id"]] + before, f"status {resp.status}")
    resp = admin.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": last["PlaylistItemId"]})
    check("administrator removes a track", resp.status == 204 and [r["Id"] for r in admin_rows()] == before, f"status {resp.status}")
    check("administrator gets smart shuffle and export of that playlist",
          sorted(admin.get(f"/PlaylistToolkit/Playlists/{aid}/SmartShuffle").json()["ItemIds"]) == sorted(before)
          and admin.get(f"/PlaylistToolkit/Playlists/{aid}/Export").text().count("#EXTINF:") == 5)

    # Move and remove through the plugin for normal users: owner yes, listen-only no, stranger not found.
    first_row = alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"][0]
    check("listen-only user cannot move or remove tracks through the plugin",
          bob.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/2").status == 403
          and bob.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": first_row["PlaylistItemId"]}).status == 403)
    check("user without access cannot move or remove tracks through the plugin",
          dave.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/2").status == 404
          and dave.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": first_row["PlaylistItemId"]}).status == 404)
    resp = alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/2")
    moved = [r["Id"] for r in alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]]
    check("owner moves a track through the plugin", resp.status == 204 and moved == before[1:3] + [before[0]] + before[3:], f"status {resp.status}")
    resp = alice.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": first_row["PlaylistItemId"]})
    check("owner removes a track through the plugin",
          resp.status == 204 and [r["Id"] for r in alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]] == before[1:], f"status {resp.status}")
    remaining_rows = alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]
    check("invalid move requests are rejected cleanly",
          alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/not-an-id/Move/0").status == 400
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{remaining_rows[0]['PlaylistItemId']}/Move/-1").status in (400, 404)
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{remaining_rows[0]['PlaylistItemId']}/Move/{len(remaining_rows)}").status == 400
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{remaining_rows[0]['PlaylistItemId']}/Move/9999").status == 400
          and alice.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{first_row['PlaylistItemId']}/Move/0").status == 404
          and [r["Id"] for r in alice.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]] == [r["Id"] for r in remaining_rows])

    # A user with edit permission (not the owner) uses the plugin's move and remove.
    alice.post(f"/PlaylistToolkit/Playlists/{aid}/Sharing", {"Shares": [{"UserId": dave.user_id, "CanEdit": True}, {"UserId": bob.user_id, "CanEdit": False}]})
    editor_rows = lambda: dave.get(f"/PlaylistToolkit/Playlists/{aid}/Items").json()["Items"]
    start_ids = [r["Id"] for r in editor_rows()]
    resp = dave.post(f"/PlaylistToolkit/Playlists/{aid}/Items/{editor_rows()[0]['PlaylistItemId']}/Move/{len(start_ids) - 1}")
    check("editor moves a track through the plugin", resp.status == 204 and [r["Id"] for r in editor_rows()] == start_ids[1:] + [start_ids[0]], f"status {resp.status}")
    resp = dave.delete(f"/PlaylistToolkit/Playlists/{aid}/Items", params={"entryIds": editor_rows()[0]["PlaylistItemId"]})
    check("editor removes a track through the plugin", resp.status == 204 and [r["Id"] for r in editor_rows()] == start_ids[2:] + [start_ids[0]], f"status {resp.status}")
    check("editor still cannot change image, description or sharing",
          dave.post(f"/PlaylistToolkit/Playlists/{aid}/Description", {"Overview": "x"}).status == 403
          and dave.post(f"/PlaylistToolkit/Playlists/{aid}/Sharing", {"Shares": []}).status == 403)

    # ---------------------------------------------------------------- image removal
    check("owner removes the image", alice.delete(f"/PlaylistToolkit/Playlists/{pid}/Image").status == 204)

    # ---------------------------------------------------------------- 5. duplicates
    album_song = next(i for i in small if i["Name"] == "Amber Song 11" and "Single" not in i["Path"])
    single_song = next(i for i in small if i["Name"] == "Amber Song 11" and "Single" in i["Path"])
    others = [i for i in small if i["Name"] != "Amber Song 11" and "Amber Fox Album 1" not in i["Path"]]
    first, second, fresh = others[0], others[1], others[2]
    dup_pid = create_playlist(alice, "T-Dup", [first["Id"], second["Id"]])
    alice.post(f"/Playlists/{dup_pid}/Items", params={"ids": album_song["Id"], "userId": alice.user_id})
    resp = alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Duplicates", {"Ids": [first["Id"], single_song["Id"], fresh["Id"]]})
    result = resp.json()
    kinds = {d["Id"]: d["Kind"] for d in result["Duplicates"]}
    check("duplicate check: same item is 'exact', same song from another album is 'similar', new track is new",
          kinds == {first["Id"]: "exact", single_song["Id"]: "similar"} and result["NewIds"] == [fresh["Id"]] and result["Total"] == 3, str(result)[:300])
    album_id = alice.get(f"/Items/{album_song['Id']}", params={"UserId": alice.user_id}).json()["AlbumId"]
    result = alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Duplicates", {"Ids": [album_id]}).json()
    check("duplicate check expands an album to its tracks", result["Total"] == 4 and len(result["Duplicates"]) >= 1 and len(result["NewIds"]) + len(result["Duplicates"]) == 4, str(result)[:200])
    resp = alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Items", {"Ids": result["NewIds"]})
    count = alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Items").json()["TotalRecordCount"]
    check("owner adds only the new tracks", resp.status == 200 and resp.json()["Added"] == len(result["NewIds"]) and count == 3 + len(result["NewIds"]), f"count={count}")
    alice.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Sharing", {"Shares": [{"UserId": bob.user_id, "CanEdit": False}]})
    check("listen-only user can run the duplicate check but cannot add",
          bob.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Duplicates", {"Ids": [fresh["Id"]]}).status == 200
          and bob.post(f"/PlaylistToolkit/Playlists/{dup_pid}/Items", {"Ids": [fresh["Id"]]}).status == 403)
    check("stock add with an empty id list is a no-op (used to cancel an add in the web client)",
          alice.post(f"/Playlists/{dup_pid}/Items", params={"ids": "", "userId": alice.user_id}).status == 204
          and alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Items").json()["TotalRecordCount"] == count)

    # ---------------------------------------------------------------- 2. table rows, long playlist
    big_ids = [i["Id"] for i in bulk[:2500]]
    big_pid = create_playlist(alice, "T-Big", big_ids)
    wait_until(lambda: alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items").json()["TotalRecordCount"] == 2500, timeout=60)
    alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items")
    start = time.time()
    resp = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items")
    own_time = time.time() - start
    rows = resp.json()
    row = rows["Items"][0]
    check("track table rows for 2500 tracks", rows["TotalRecordCount"] == 2500 and [r["Id"] for r in rows["Items"]] == big_ids)
    check("row has title, artist, album, duration", row["Name"] and row["Artists"] and row["Album"] and row["RunTimeTicks"] and row["AlbumId"] and row["PlaylistItemId"], str(row))
    start = time.time()
    stock_rows = alice.get(f"/Playlists/{big_pid}/Items", params={"userId": alice.user_id, "Fields": "PrimaryImageAspectRatio,MediaSourceCount,Chapters,Trickplay"})
    stock_time = time.time() - start
    check("2500 rows load in under 1.5 s", own_time < 1.5, f"plugin {own_time:.2f} s / {len(resp.body) // 1024} KB, stock list request {stock_time:.2f} s / {len(stock_rows.body) // 1024} KB")
    check("rows are not readable without access", bob.get(f"/PlaylistToolkit/Playlists/{big_pid}/Items").status == 404)

    # ---------------------------------------------------------------- 4. smart shuffle
    artist_of = {r["Id"]: r["Artists"][0] for r in rows["Items"]}
    start = time.time()
    order = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
    shuffle_time = time.time() - start
    check("smart shuffle returns every track once", sorted(order) == sorted(big_ids) and order != big_ids, f"{shuffle_time:.2f} s")
    repeats = sum(1 for a, b in zip(order, order[1:]) if artist_of[a] == artist_of[b])
    check("smart shuffle: no artist twice in a row (2500 tracks)", repeats == 0, f"repeats={repeats}")
    again = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
    check("smart shuffle differs from call to call", again != order)
    seeded = [alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", params={"seed": "5"}).json()["ItemIds"] for _ in range(2)]
    check("smart shuffle is reproducible with a seed", seeded[0] == seeded[1])

    # Songs the caller disliked (Jellyfin's own rating) are left out of the smart shuffle; other users are not affected.
    disliked_ids = order[:3]
    for track_id in disliked_ids:
        alice.post(f"/UserItems/{track_id}/Rating", params={"userId": alice.user_id, "likes": "false"})
    try:
        without = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
        check("smart shuffle leaves out the caller's disliked songs", set(without).isdisjoint(disliked_ids) and len(without) == len(big_ids) - 3, f"{len(without)} ids")
    finally:
        for track_id in disliked_ids:
            alice.delete(f"/UserItems/{track_id}/Rating", params={"userId": alice.user_id})

    # Mark tracks as played: 40 just now, 10 a month ago, 30 by another user.
    played = order[:40]
    now = datetime.datetime.now(datetime.timezone.utc)
    for n, item_id in enumerate(played):
        stamp = (now - datetime.timedelta(minutes=n)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        assert alice.post(f"/UserPlayedItems/{item_id}", params={"userId": alice.user_id, "datePlayed": stamp}).status == 200
    old = order[100:110]
    for item_id in old:
        stamp = (now - datetime.timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        alice.post(f"/UserPlayedItems/{item_id}", params={"userId": alice.user_id, "datePlayed": stamp})
    for item_id in order[200:230]:
        bob.post(f"/UserPlayedItems/{item_id}", params={"userId": bob.user_id})

    # Expected result from the server's own play history (earlier test runs leave history behind).
    hours = admin.get(f"/Plugins/{PLUGIN_ID}/Configuration").json()["SmartShuffleRecentHours"]
    history = alice.get("/Items", params={"IncludeItemTypes": "Audio", "Recursive": "true", "UserId": alice.user_id,
                                          "IsPlayed": "true", "EnableUserData": "true", "Limit": "5000"}).json()["Items"]
    last_played = {i["Id"]: datetime.datetime.fromisoformat(i["UserData"]["LastPlayedDate"].replace("Z", "+00:00")[:19] + "+00:00")
                   for i in history if i["Id"] in artist_of and i["UserData"].get("LastPlayedDate")}
    recent = sorted((i for i, t in last_played.items() if t > now - datetime.timedelta(hours=hours)), key=last_played.get)
    older_half, newer_half = recent[:len(recent) - len(recent) // 2], recent[len(recent) - len(recent) // 2:]
    order2 = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle").json()["ItemIds"]
    # The artist rule has priority, so a few not-recent tracks can end up between the recent ones.
    slack = 10
    check("smart shuffle: recently played tracks are at the end",
          set(played) <= set(recent) and set(recent) <= set(order2[-(len(recent) + slack):]), f"{len(recent)} recent of {len(order2)}")
    check("smart shuffle: the most recently played tracks come after the older recent ones",
          set(recent[-10:]) <= set(order2[-(len(newer_half) + slack):]))
    not_recent = (set(old) | set(order[200:230])) - set(recent)
    check("smart shuffle: tracks played long ago and other users' plays are not pushed back",
          len(not_recent & set(order2[-(len(recent) + slack):])) <= 3, f"{len(not_recent)} tracks")
    repeats2 = sum(1 for a, b in zip(order2, order2[1:]) if artist_of[a] == artist_of[b])
    check("smart shuffle: still no artist twice in a row with play history", repeats2 == 0, f"repeats={repeats2}")

    # Endless mode: a new order that follows a given track never opens with that track's artist.
    after_id = order2[-1]
    openers = set()
    for _ in range(12):
        again = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", params={"after": after_id}).json()["ItemIds"]
        openers.add(artist_of[again[0]])
        if len(again) != 2500 or artist_of[again[0]] == artist_of[after_id]:
            openers = None
            break
    check("endless mode: the reshuffled order is complete and never opens with the artist that just played", bool(openers), str(openers)[:120])

    # Endless mode: tracks still waiting in the queue must not open the next round.
    waiting = [i for i in big_ids if i not in last_played][:6]
    opened_with_waiting = 0
    for _ in range(8):
        plain = alice.get(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", params={"after": waiting[-1]}).json()["ItemIds"]
        resp = alice.post(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", {"After": waiting[-1], "Pending": waiting})
        told = resp.json()["ItemIds"]
        if resp.status != 200 or sorted(told) != sorted(big_ids) or set(waiting) & set(told[:-(len(waiting) + 10)]) or artist_of[told[0]] == artist_of[waiting[-1]]:
            opened_with_waiting = None
            break
        opened_with_waiting += len(set(waiting) & set(plain[:2000]))
    check("endless mode: tracks still waiting in the queue come last in the next round",
          opened_with_waiting is not None and opened_with_waiting > 0,
          f"without the hint {opened_with_waiting} of 48 waiting tracks were in the first 2000 positions")
    check("continuing a smart shuffle needs access to the playlist",
          bob.post(f"/PlaylistToolkit/Playlists/{big_pid}/SmartShuffle", {"After": waiting[-1], "Pending": waiting}).status == 404)

    one_artist = [i["Id"] for i in small if "Amber Fox" in i["Path"]][:5] + [i["Id"] for i in small if "Blue Heron" in i["Path"]][:5]
    mix_pid = create_playlist(alice, "T-TwoArtists", one_artist)
    for _ in range(10):
        mix = alice.get(f"/PlaylistToolkit/Playlists/{mix_pid}/SmartShuffle").json()["ItemIds"]
        names = ["A" if i in one_artist[:5] else "B" for i in mix]
        if any(a == b for a, b in zip(names, names[1:])):
            break
    else:
        names = None
    check("smart shuffle alternates strictly when two artists have equal shares", names is None, str(names))
    starts = set()
    for _ in range(10):
        mix = alice.get(f"/PlaylistToolkit/Playlists/{mix_pid}/SmartShuffle", params={"after": one_artist[0]}).json()["ItemIds"]
        starts.add("A" if mix[0] in one_artist[:5] else "B")
    check("endless mode with two artists: after artist A the new order always starts with B", starts == {"B"}, str(starts))
    tiny_waiting = one_artist[:2] + one_artist[5:7]
    positions = []
    for _ in range(10):
        mix = alice.post(f"/PlaylistToolkit/Playlists/{mix_pid}/SmartShuffle", {"After": tiny_waiting[-1], "Pending": tiny_waiting}).json()["ItemIds"]
        positions.append(min(mix.index(i) for i in tiny_waiting))
    check("endless mode on a 10-track playlist: the 4 waiting tracks are the last 4 of the next round", min(positions) >= 6, str(positions))

    # ---------------------------------------------------------------- playback command
    check("play without an open client connection is refused cleanly",
          alice.post("/PlaylistToolkit/Play", {"ItemIds": order[:5], "StartIndex": 0}).status == 409)
    player = jf.login("alice", device_id="pt-test-player")
    caps = player.post("/Sessions/Capabilities/Full", {"PlayableMediaTypes": ["Audio"], "SupportedCommands": ["Play"], "SupportsMediaControl": True})
    socket_path = "/socket?" + urllib.parse.urlencode({"ApiKey": player.token, "deviceId": player.device_id})
    ws = wsclient.WebSocket(jf.BASE, socket_path)
    try:
        time.sleep(1)
        max_queue = alice.get("/PlaylistToolkit/Config").json()["MaxQueueSize"]
        resp = player.post("/PlaylistToolkit/Play", {"ItemIds": order2, "StartIndex": 10})
        message = ws.wait_for("Play", timeout=15) if resp.status == 200 else {}
        data = message.get("Data", {})
        got = [g.replace("-", "") for g in data.get("ItemIds", [])]
        check("play command reaches the calling client over its own connection",
              resp.status == 200 and got == order2[10:10 + max_queue] and data.get("PlayCommand") == "PlayNow" and data.get("StartIndex") == 0,
              f"caps={caps.status} play={resp.status} {resp.text()[:120]} queued={len(got)}")
        check("play reports how many tracks were left out", resp.status == 200 and resp.json() == {"Queued": max_queue, "Truncated": 2500 - 10 - max_queue}, resp.text())
        resp = player.post("/PlaylistToolkit/Play", {"ItemIds": order2[:3], "Mode": "next"})
        message = ws.wait_for("Play", timeout=15) if resp.status == 200 else {}
        check("play next is sent as PlayNext", message.get("Data", {}).get("PlayCommand") == "PlayNext")
        check("the web client can resolve a full queue in one request (URL length)",
              player.get("/Items", params={"Ids": ",".join(order2[:max_queue]), "UserId": player.user_id, "Limit": "300",
                                           "Fields": "Chapters,MediaSources,Trickplay", "ExcludeLocationTypes": "Virtual",
                                           "EnableTotalRecordCount": "false", "CollapseBoxSetItems": "false"}).status == 200)
    finally:
        ws.close()

    # ---------------------------------------------------------------- 7. M3U
    resp = alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Export")
    m3u = resp.text()
    dup_rows = alice.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Items").json()["Items"]
    check("M3U export", resp.status == 200 and m3u.startswith("#EXTM3U") and m3u.count("#EXTINF:") == len(dup_rows)
          and "attachment" in resp.headers.get("Content-Disposition", ""), resp.headers.get("Content-Disposition", ""))
    check("M3U export needs access", carol.get(f"/PlaylistToolkit/Playlists/{dup_pid}/Export").status == 404)
    resp = bob.post("/PlaylistToolkit/Import", {"Name": "T-Imported", "Content": m3u})
    imported = resp.json() if resp.status == 200 else {}
    check("M3U import creates a playlist with the same tracks in the same order",
          resp.status == 200 and imported["Matched"] == len(dup_rows) and imported["Unmatched"] == []
          and [r["Id"] for r in bob.get(f"/PlaylistToolkit/Playlists/{imported['PlaylistId']}/Items").json()["Items"]] == [r["Id"] for r in dup_rows], resp.text()[:200])
    new_info = bob.get(f"/PlaylistToolkit/Playlists/{imported['PlaylistId']}").json() if imported else {}
    check("imported playlist is private and owned by the importing user",
          new_info.get("IsOwner") and not new_info.get("OpenAccess") and alice.get(f"/PlaylistToolkit/Playlists/{imported.get('PlaylistId')}").status == 404)
    foreign = "#EXTM3U\n#EXTINF:3,Blue Heron - Blue Song 12\nD:\\Music\\elsewhere\\whatever.mp3\n#EXTINF:100,Nobody - Missing Song\n/nowhere/missing.mp3\n" \
              + "C:\\other\\" + small[5]["Path"].rsplit("/", 1)[1] + "\n"
    resp = bob.post("/PlaylistToolkit/Import", {"Name": "T-Foreign", "Content": foreign})
    result = resp.json() if resp.status == 200 else {}
    check("M3U import matches by artist/title and by file name, reports the rest",
          result.get("Total") == 3 and result.get("Matched") == 2 and len(result.get("Unmatched", [])) == 1 and "Missing Song" in result["Unmatched"][0], resp.text()[:300])
    check("M3U import cannot append to a playlist without edit right",
          bob.post("/PlaylistToolkit/Import", {"PlaylistId": dup_pid, "Content": m3u}).status == 403)
    check("M3U import with nothing matching creates no playlist",
          bob.post("/PlaylistToolkit/Import", {"Name": "T-Nothing", "Content": "/nowhere/a.mp3\n"}).json()["PlaylistId"] == "00000000000000000000000000000000")
    check("M3U import without name is rejected", bob.post("/PlaylistToolkit/Import", {"Content": m3u}).status == 400)

    # ---------------------------------------------------------------- Instant Mix untouched
    mix_track = alice.get(f"/Items/{small[0]['Id']}/InstantMix", params={"UserId": alice.user_id, "Limit": "20"})
    mix_list = alice.get(f"/Playlists/{pid}/InstantMix", params={"UserId": alice.user_id, "Limit": "20"})
    check("stock Instant Mix endpoints still answer", mix_track.status == 200 and mix_list.status == 200, f"{mix_track.status}/{mix_list.status}")

    # ---------------------------------------------------------------- administrator on a visible playlist
    alice.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"OpenAccess": True})
    admin_info = admin.get(f"/PlaylistToolkit/Playlists/{pid}").json()
    check("administrator may manage, share and edit a public playlist of another user, but is not its owner",
          admin_info["CanManage"] and admin_info["CanShare"] and admin_info["CanEditItems"] and not admin_info["IsOwner"])
    check("public playlist: other normal user still cannot manage it",
          bob.post(f"/PlaylistToolkit/Playlists/{pid}/Description", {"Overview": "x"}).status == 403
          and bob.post(f"/PlaylistToolkit/Playlists/{pid}/Sharing", {"Shares": []}).status == 403
          and bob.post(f"/PlaylistToolkit/Playlists/{pid}/Items", {"Ids": [small[40]["Id"]]}).status == 403)

    delete_test_playlists([alice, bob, carol, dave, admin])
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} of {len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
