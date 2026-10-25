from .domain import Day

NAMES = [
    "Flying Lotus",
    "Thundercat",
    "Kamasi Washington",
    "Björk",
    "Massive Attack",
    "DJ Shadow",
    "Kendrick Lamar",
    "Radiohead",
    "Taylor Swift",
    "A. R. Rahman",
    "BTS",
    "Arijit Singh",
]
GENRES = [
    "jazz-fusion",
    "jazz-fusion",
    "jazz-fusion",
    "art-pop",
    "trip-hop",
    "trip-hop",
    "hip-hop",
    "art-rock",
    "pop",
    "film-music",
    "pop",
    "film-music",
]
SLOTS = [
    ["Taylor Swift", "Flying Lotus", "Thundercat"],
    ["Kamasi Washington", "DJ Shadow", "Kendrick Lamar"],
    ["A. R. Rahman", "Radiohead", "Björk"],
    ["BTS", "Massive Attack", "Arijit Singh"],
]


def demo(catalogue=None):
    catalogue = catalogue or {}
    ids = {n: f"act-{i}" for i, n in enumerate(NAMES)}
    return Day.model_validate(
        {
            "name": "Crosswinds · rehearsal day",
            "stages": [
                {"id": f"stage-{i}", "name": n, "opens": 960, "closes": 1200}
                for i, n in enumerate(["Main", "Grove", "Warehouse"])
            ],
            "acts": [
                {
                    "id": ids[n],
                    "name": n,
                    "qloo_id": catalogue.get(n),
                    "duration": 50,
                    "changeover": 10,
                    "allowed_stages": [f"stage-{j}" for j in range(3)],
                    "earliest": 960,
                    "latest": 1200,
                    "locked": n in ["Taylor Swift", "Kamasi Washington", "BTS"],
                    "genre": GENRES[i],
                }
                for i, n in enumerate(NAMES)
            ],
            "draft": [
                {"act_id": ids[n], "stage_id": f"stage-{j}", "start": 960 + i * 60}
                for i, row in enumerate(SLOTS)
                for j, n in enumerate(row)
            ],
            "grid": 60,
        }
    )
