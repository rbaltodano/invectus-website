#!/usr/bin/env python3
"""Compact the hero map data from an inVectus project's CLI exports.

    invectus regions map -p <project> -c papers --out map.json
    invectus gaps list   -p <project> -c papers --limit 30 --json > gaps.json
    python3 -I website/scripts/build_map_data.py map.json gaps.json website/assets/ophthalmology-map.js

Keeps titles, years, roles and map positions only (never abstracts or other source text).
Map positions are for browsing only; they never decide regions or gaps.
"""
import json
import sys

ROLE = {"demand": "d", "coverage": "c", "neutral": "n"}


def main(map_path, gaps_path, out_path):
    m = json.load(open(map_path))
    g = json.load(open(gaps_path))
    fine = [r for r in m["regions"] if r["level"] == "fine"]
    out = {
        "source": "Ophthalmology Research: 5,000 PubMed papers, BGE-small, one region run and gap scan",
        "note": m["note"],
        "regions": [
            {"id": r["region_id"], "label": r.get("llm_label") or r["label"], "x": round(r["x"], 2),
             "y": round(r["y"], 2), "radius": round(r["radius"], 2), "size": r["size"]}
            for r in fine
        ],
        # [x, y, fine region, role, year, title index]
        "points": [],
        "titles": [],
        "gap_count": len(g["gaps"]),
        "gaps": [
            {"kind": x["kind"], "a": x["region_a"], "b": x["region_b"], "label": x["label"],
             "explanation": x["explanation"], "score": round(x["score"], 2),
             "demand": x["demand"], "coverage": x["coverage"]}
            for x in g["gaps"][:12]
        ],
    }
    for p in m["points"]:
        year = int(p["date"][:4]) if p.get("date") else None
        out["points"].append([round(p["x"], 2), round(p["y"], 2), p["fine_id"], ROLE.get(p["role"], "n"), year,
                              len(out["titles"])])
        out["titles"].append(p.get("title") or "")
    # A script, not JSON, so the page also works when opened from disk.
    with open(out_path, "w") as f:
        f.write("window.INVECTUS_MAP=")
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")


if __name__ == "__main__":
    main(*sys.argv[1:4])
