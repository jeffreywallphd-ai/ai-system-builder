# Provided-data version journeys

This private qualification composition tests saved dataset versions in the real
packaged Desktop app and the browser app. It does not generate model output.
Normal qualification commands keep their existing controlled worker.

The fixed worker admits one small synthetic CSV, classification, provided rows,
validation and splitting, JSON Lines output, and the normal review operation.
It delegates to the packaged production task, quality checks and output writer.
It rejects other task types, generation, OCR, model downloads, advanced processing,
external paths, directory links and inputs larger than 16 KiB. Offline flags,
launch authentication and production runtime dependency preparation remain active.
Failure records contain closed error categories, not source data or exceptions.

The browser test uses a dedicated organization and the production local SQLite
adapter through an explicit test-only composition seam. The Settings restart
action closes background tasks, the listener, composition persistence and the
externally owned SQLite connection before opening them again. A failed close
prevents another owner. A fresh exclusive second-session record is required;
an HTTP readiness response alone does not prove restart. This is not PostgreSQL
deployment qualification.

Both tests import eight synthetic classification rows, prepare and explicitly
save them, verify complete bytes and digests, inspect history and comparison,
restore the supported setup, and explicitly prepare and save a second version.
They check the original bytes and lineage again after complete host restart.
They also prepare and discard once through the restarted runtime. Desktop keeps
the same app data and uses a fresh worker evidence cache for each session.
Its closed restart phase names give each shutdown a separate acknowledgment
and exclusive report. Existing ordinary shutdown filenames remain unchanged.

The focused launch-plan test also exercises Playwright's actual module-loading
order. Its import-only global setup loads the shared ESM modules first. Both app
specs must then collect and skip with the required scenario absent, while a third
app-free test executes the shared restart-path resolver through a native file-URL
import. This catches TypeScript/CommonJS and ESM loading conflicts without opening
an app, browser or worker. It does not replace either real host journey.

The separately reviewed fixed operator binds the exact source identity, Python
executable, package and two selected tests. It uses the existing `dataset-profile`
native role: 1 GiB per process, 2 GiB package job, 3 GiB UI job, 32 members, and
the existing time, environment, ownership and retirement checks. Do not select
the OCR role or raise limits after failure. Source checks alone do not run or
qualify these host journeys. Retain actual failed and incomplete evidence.

This work supports Data increment 3. It does not grant parent qualification,
remote provider card rendering, remote cleanup, scale, advanced quality gains,
model accuracy or OCR qualification. Existing successful provider and OCR
evidence remains separate; do not repeat accepted model accuracy checks.
