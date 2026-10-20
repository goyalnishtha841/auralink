# Recordings (Member B)

Audio stays out of git (consent + size). Share it on the team drive and keep only this index here.

Layout: `<speaker_id>/<intent>_<take>.wav`, 16 kHz mono. Track every clip in `eval/manifest.csv`:
`file,speaker_id,accent,age_band,intent,transcript,split` where `split` is train / heldout / test **by speaker**,
so the same voice never appears in both tuning and test data.
