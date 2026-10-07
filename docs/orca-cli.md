# Verified Orca CLI contract

Orca Web pins the official [OrcaSlicer v2.4.2 release](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.4.2). The Linux x86_64 artifact is `OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage` with SHA-256:

```text
d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd
```

The downloaded checksum was compared with the official GitHub release asset digest and verified locally. `scripts/install-orca.sh` rejects a mismatched download, extracts the AppImage without FUSE, and preserves its runtime and resources. The image runs on Ubuntu 24.04 with Node 22. The current Docker pin supports x86_64 hosts.

The executable is `/opt/orca/AppRun`; installed resources are `/opt/orca/resources`. The release runs CLI slicing with `DISPLAY` unset. Xvfb, a desktop, and GUI forwarding are unnecessary and are absent from the image.

## Bundled preset source of truth

The following installed profiles were verified by actually slicing `fixtures/cube-20mm.stl`:

| Kind | Profile |
| --- | --- |
| Machine | `Creality Ender-3 V3 KE 0.4 nozzle` |
| Process | `0.20mm Standard @Creality Ender3V3KE` |
| Filament | `Creality Generic PLA @Ender-3V3-all` |

The filament requested in the original specification, `Generic PLA @Creality Ender-3V3-all`, was renamed upstream. Orca Web selects the current bundled default identified by the machine's `default_filament_profile` instead of maintaining an obsolete or manually reconstructed filament profile.

The bundled machine specifies Klipper G-code, a printable polygon from `(0, 0)` to `(220, 220)`, and a printable height of `245` mm. The backend derives the viewer's volume from this profile.

`--load-settings` does not resolve the bundled profiles' `inherits` chains. The backend resolves parent profiles from the installation, copies the resolved machine/process/filament JSON into each job's work directory, and removes `inherits` from those standalone copies. Installed presets remain unchanged. Names, `type`, and `from: system` are preserved so G-code records the selected system profiles.

The catalog also exposes `Creality Ender-3 Pro` nozzle variants (0.2, 0.4, 0.6, and 0.8 mm) when compatible bundled processes and filaments exist. A real browser slice verified the 0.4 mm Pro with `0.20mm Standard @Creality Ender3 Pro 0.4` and `Creality Generic PLA`. Its stock machine profile supplies Marlin start/end G-code, a 220 × 220 × 250 mm volume, and Bowden retraction defaults. The KE 0.4 mm remains the application default.

Advanced tuning writes scalar strings to the process profile, string arrays to machine/filament profiles, and mirrors explicit retraction overrides into the filament override keys because Orca gives them precedence. The integration test checks all exposed tuning keys in generated G-code. Ambient temperature is an application-level input: it adjusts first-layer nozzle and plate temperatures before profile serialization, with manual values applied first and machine/material limits applied last. The Pro browser test verifies actual `M109 S222` / `M190 S64` heating commands for 15°C ambient and manual first-layer targets of 220°C nozzle / 60°C bed. See the [ambient tuning behavior](../README.md#included-workflow) for the heuristic and its limits.

## Invocation

The verified argument array is equivalent to:

```text
--debug 3
--logfile JOB/work/orca.log
--datadir JOB/work/datadir
--load-settings JOB/work/machine.json;JOB/work/process.json
--load-filaments JOB/work/filament.json
--allow-rotations=0
--ensure-on-bed
--arrange 1
--slice 0
--outputdir JOB/output
--
JOB/input/model.stl
```

Every item is a separate argument except the semicolon-separated settings value and `--allow-rotations=0`. Node calls `spawn()` with `shell: false`; this listing is documentation, not a shell command assembled from uploads. Orca's `--help` starts with `OrcaSlicer-2.4.2`; this release has no supported `--version` flag.

`--orient 1` successfully auto-orients a model. `--arrange 0` disables arrangement, so the application's generated model placement must already be inside the bed. The default arrangement permits rotation unless `--allow-rotations=0` is supplied. Neither `--no-allow-rotations` nor `--allow-rotations 0` is accepted. The server reads the regular Orca logfile to supply actual output to its bounded logs and SSE stream; an invented progress percentage is unnecessary. A logfile pointed at `/dev/stdout` works with a shell redirect or Python's ordinary pipes but aborts when Node supplies Unix socket endpoints for child-process output. Use a job-owned regular file for the Node runner.

## Rotation and scale compatibility

The v2.4.2 Linux CLI advertises `--rotate-x`, `--rotate-y`, `--rotate`, and `--scale`, but isolated actual STL slicing probes crashed with SIGSEGV for all four. Even explicit zero rotations crashed. Orca Web therefore represents transforms using a standard 3MF build item instead of sending these broken flags.

The generated project contains only standard geometry and a transform, with no printer or process settings. The selected installed profiles stay authoritative. Its package entries are `[Content_Types].xml`, `_rels/.rels`, and `3D/3dmodel.model`. The model uses the core `http://schemas.microsoft.com/3dmanufacturing/core/2015/02` namespace and millimeter units.

The 3MF build transform stores twelve numbers: `r00 r10 r20 r01 r11 r21 r02 r12 r22 tx ty tz`. For X, Y, then Z rotation, its linear matrix is `scale × Rz × Ry × Rx`. A 20 mm cube scaled to 1.5 produced a 30 mm G-code height. X=90°, Z=90°, and Z=35° also produced valid G-code. A combined X=15°, Y=25°, Z=35° rotation at scale 1.5 produced a 46 mm height, agreeing with its geometric bound of 45.9784 mm, when supports were enabled. Without supports, Orca correctly rejected that tilted cube for floating regions.

## Output and integration checks

Orca generates `plate_1.gcode` and `result.json`. After validation, the server renames G-code to the uploaded STL's base name: `part.stl` becomes `part.gcode`. Multiple plates use `part_plate_1.gcode`, `part_plate_2.gcode`, and so on; stored result names, URLs, and download headers all use those names. A real upload through the standalone Node 22 server produced a nonempty 295,152-byte G-code file before thumbnail embedding (303,360 bytes with previews). Its output contains these verifiable metadata keys:

```text
printer_settings_id = Creality Ender-3 V3 KE 0.4 nozzle
printer_model = Creality Ender-3 V3 KE
gcode_flavor = klipper
print_settings_id = 0.20mm Standard @Creality Ender3V3KE
filament_settings_id = "Creality Generic PLA @Ender-3V3-all"
```

Print-duration and filament measurements are comments near the end of the file: `estimated printing time (normal mode)`, `filament used [mm]`, and `filament used [g]`. The server checks the generated file and selected printer before exposing a download.

## Embedded printer thumbnails

Real headless v2.4.2 exports contain no thumbnail blocks, despite the KE preset requesting 96×96 and 300×300 images. Orca's thumbnail exporter requires a rendering callback that the headless slicing path does not supply. See the pinned [Orca thumbnail exporter](https://github.com/OrcaSlicer/OrcaSlicer/blob/v2.4.2/src/libslic3r/GCode/Thumbnails.hpp).

After validation and renaming, the server streams the G-code twice to render an isometric preview from actual extrusion paths. Supports are blue; the part is orange. Startup purge paths, travel, retraction, brim, skirt, and wipe towers do not determine the image frame. The parser handles absolute/relative coordinates and extrusion, position resets, and XY arcs. PNG encoding uses Node's built-in zlib; no graphics runtime is added.

Each file begins with native Creality PNG blocks at 96×96 then 300×300, followed by standard blocks at both sizes. The native header is `; png begin WIDTH*HEIGHT BASE64_LENGTH FIRST_ROW LAST_ROW LAYER_COUNT`, with payload lines of at most 78 characters and `; png end`. The standard header is `; thumbnail begin WIDTHxHEIGHT BASE64_LENGTH`, ending with `; thumbnail end`. Native headers follow the [Creality Print exporter](https://github.com/CrealityOfficial/CrealityPrint/blob/master/src/libslic3r/GCode/Thumbnails.hpp). The original G-code remains a byte-for-byte suffix, and an atomic replacement updates the output only after thumbnail generation succeeds. Result sizes include the image comments.

Unit tests verify PNG checksums/pixels, comment lengths, preservation, cancellation, extrusion modes, framing, and arcs. Real integration slices verify both formats for stock and transformed models; browser tests decode every embedded PNG. Firmware display behavior requires a device check. Existing outputs are unchanged; rebuild the app and re-slice/re-upload to obtain preview-bearing files.

Run the mandatory real slicing integration check in the Docker runtime:

```bash
docker build --target integration -t orca-web-integration .
docker run --rm --cap-drop ALL --security-opt no-new-privileges orca-web-integration
```

`pnpm test:integration:docker` runs these steps through `scripts/test-docker-integration.sh`.

The integration target executes `pnpm test:integration`, which exercises the application with the real bundled runtime and cube fixture. Repeat it for every Orca upgrade, together with the Playwright browser workflow. Updating the version or digest in the Dockerfile is a deliberate repository change.
