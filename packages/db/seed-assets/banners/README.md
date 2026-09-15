# Banner artwork

Drop finished banner images here and `pnpm db:seed` uses them instead of the
generated placeholders. Nothing else changes — same rows, same links, same
schedule.

## Where the file goes

One file per banner, named for its key:

```
packages/db/seed-assets/banners/
  welcome.jpg            ← جيبلي أكل — أهلاً بك في جيبلي
  grills.jpg             ← جيبلي أكل — مشاوي على الفحم
  sweets.jpg             ← جيبلي أكل — حلويات وقهوة
  market_welcome.jpg     ← جيبلي ماركت — جيبلي ماركت
  market_produce.jpg     ← جيبلي ماركت — خضار وفواكه طازجة
  market_household.jpg   ← جيبلي ماركت — تسوّق الشهر
```

`.jpg`, `.jpeg`, `.png` and `.webp` are all read. A key with no file keeps its
generated placeholder, so you can replace them one at a time.

## The size

**16:9**, exported at **1920 × 1080**. That covers the largest phone at 3×
without upscaling; 1280 × 720 is enough if the file size matters more than the
sharpness.

Keep it **under about 600KB**. The seed prints a warning past that, because
the home screen loads this before anything else and a full-quality export is
several megabytes over an Iraqi phone network. A 1920 × 1080 JPEG at quality
80 lands around 300KB and looks the same.

### Two slots, one file

The same image is shown in two places, and they are not the same shape:

|                     |                        |                                  |
| ------------------- | ---------------------- | -------------------------------- |
| **Home carousel**   | exactly 16:9           | what the ratio above is for      |
| **Section chooser** | as tall as the file is | half the screen, less the header |

Neither crops horizontally, so nothing you put in the frame is ever cut off
the sides. The chooser sizes its panel from the file itself: a 16:9 banner
fills about half the screen there and a squarer one fills more.

If you want the chooser to be **all artwork and no white**, export the same
design again at **4:5 (1080 × 1350)** or **1:1**. The first banner of each
section is the one it shows, so only `welcome` and `market_welcome` matter for
that screen — and the home carousel still wants its 16:9, so that is a second
export rather than a replacement.

## What to put in the image

Everything. The app draws **no text over artwork** — when a banner has an
image, the image is the whole banner. The title stored beside it is only a
label for finding the row in Admin and the text a screen reader announces.

Two things worth knowing while designing:

- The banner runs **edge to edge** with square corners. There is no card frame
  and no padding, so anything within about 24px of an edge is near the screen
  edge on a phone.
- It sits under the search bar and above the category strip, so the eye reaches
  it from the top.

## Adding a banner that does not exist yet

The six keys above are the seeded ones. A new banner is an Admin job rather
than a file: **لوحة التحكم ← شكل التطبيق** creates the row, uploads the art and
sets its section, schedule and link. This folder exists so a fresh database
comes up looking finished, not as the way to run merchandising.

## Not committed

`.gitignore` covers the image files here — artwork is usually large and often
licensed, and a repository is the wrong place for either. This README is
tracked; what you drop beside it is not.
