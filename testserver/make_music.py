#!/usr/bin/env python3
"""Generates tagged test tracks (short sine tones) under testserver/music and testserver/music-private.

Three sets:
  small/  a handful of artists and albums, including one song that exists on an album and as a single
  bulk/   BULK_TRACKS tracks (default 2500) for the long-playlist tests
  music-private/  a few tracks for a second library that one test user may not access
"""
import concurrent.futures
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent / "music"
PRIVATE_ROOT = pathlib.Path(__file__).resolve().parent / "music-private"  # a second library with restricted access
BULK_TRACKS = int(os.environ.get("BULK_TRACKS", "2500"))
BULK_ARTISTS = int(os.environ.get("BULK_ARTISTS", "300"))
DURATIONS = [2, 3, 4, 5, 6]


def base_file(seconds: int) -> pathlib.Path:
    path = ROOT / ".base" / f"tone{seconds}.opus"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={200 + 60 * seconds}:duration={seconds}",
             "-c:a", "libopus", "-b:a", "24k", str(path)],
            check=True)
    return path


def make(track):
    path, title, artist, album, number, seconds = track
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(base_file(seconds)), "-c", "copy",
         "-metadata", f"title={title}", "-metadata", f"artist={artist}", "-metadata", f"album_artist={artist}",
         "-metadata", f"album={album}", "-metadata", f"track={number}", str(path)],
        check=True)


def small_set():
    tracks = []
    artists = ["Amber Fox", "Blue Heron", "Crimson Tide Trio", "Dusty Owl", "Echo Lynx", "Frost Wolf"]
    for a, artist in enumerate(artists):
        for album_no in range(1, 3):
            album = f"{artist} Album {album_no}"
            for n in range(1, 5):
                title = f"{artist.split()[0]} Song {album_no}{n}"
                path = ROOT / "small" / artist / album / f"{n:02d} - {title}.opus"
                tracks.append((path, title, artist, album, n, DURATIONS[(a + n) % len(DURATIONS)]))
    # Same song as on "Amber Fox Album 1", released again as a single: a "similar" duplicate.
    tracks.append((ROOT / "small" / "Amber Fox" / "Amber Song 11 (Single)" / "01 - Amber Song 11.opus",
                   "Amber Song 11", "Amber Fox", "Amber Song 11 (Single)", 1, 3))
    return tracks


def private_set():
    tracks = []
    for n in range(1, 7):
        title = f"Secret Song {n}"
        tracks.append((PRIVATE_ROOT / "Secret Stag" / "Secret Album" / f"{n:02d} - {title}.opus", title, "Secret Stag", "Secret Album", n, DURATIONS[n % len(DURATIONS)]))
    # Same title and artist as a track of the open library: must not show up as "similar" for users without access.
    tracks.append((PRIVATE_ROOT / "Amber Fox" / "Private Album" / "09 - Amber Song 12 (private copy).opus",
                   "Amber Song 12", "Amber Fox", "Private Album", 9, 4))
    return tracks


def bulk_set():
    tracks = []
    for i in range(BULK_TRACKS):
        artist_no = (i * 7919) % BULK_ARTISTS  # spread tracks unevenly over artists
        artist = f"Bulk Artist {artist_no:03d}"
        album = f"Bulk Album {artist_no:03d}-{(i // BULK_ARTISTS) // 10 + 1}"
        title = f"Bulk Track {i:04d}"
        path = ROOT / "bulk" / artist / album / f"{i:04d} - {title}.opus"
        tracks.append((path, title, artist, album, i % 99 + 1, DURATIONS[i % len(DURATIONS)]))
    return tracks


def main():
    for seconds in DURATIONS:
        base_file(seconds)
    tracks = small_set() + bulk_set() + private_set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
        list(pool.map(make, tracks))
    print(f"{len(tracks)} tracks under {ROOT} and {PRIVATE_ROOT}")


if __name__ == "__main__":
    sys.exit(main())
