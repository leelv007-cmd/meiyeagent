# Tuzi media provider probe

- Verified at: `2026-07-14T21:51:27Z`
- Command gate: `RUN_LIVE_TUZI_MEDIA_TEST=1`
- Adapter path: `TuziMediaExecutionPort` through the shared media lifecycle port
- Image provider model: `doubao-seedream-4-5-251128`
- Video provider model: `doubao-seedance-1-5-pro_720p`
- Result: a real image and a real five-second video were submitted, polled, downloaded, and persisted locally.

The provider listed `doubao-seedream-5-0-260128`, but its live submission returned no available channel. The provider did not list Seedance 2.0. These artifacts therefore prove the Tuzi adapter and real media lifecycle, but they do not claim Seedream 5.0 or Seedance 2.0 activation.

| Artifact | Type | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `tuzi-image.png` | PNG, 2304 x 1728 | 4,087,746 | `013b0e0afd582c93bea29abe23c8c0338b0fc0dfa8c7c6cbeecb8082c10492e0` |
| `tuzi-video.mp4` | MP4 | 5,668,941 | `d9f20c683d7ac9f43fbd3a9ac31371321d89a55bed616101185cc7555a659aa2` |
| `tuzi-video-frame.png` | PNG frame at 2.5 seconds | 1,174,744 | `bcc7e913fb1f5f7078b40028e292c24bdfadc2925ad272a9c0703987e4a4b89c` |

No credential, signed provider URL, or encrypted task receipt is stored in this directory.
