---
source: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
captured: 2026-07-08
captured_via: jina (r.jina.ai)
study: ui-adaptation-study-2026-07-08
---

Title: Navigator: share() method - Web APIs | MDN

URL Source: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

Published Time: Tue, 07 Jul 2026 01:19:29 GMT

Markdown Content:
## [Syntax](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#syntax)

js

```
share(data)
```

### [Parameters](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#parameters)

[`data`Optional](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#data)
An object containing data to share.

Properties that are unknown to the user agent are ignored; share data is only assessed on properties understood by the user agent. All properties are optional but at least one known data property must be specified.

Possible values are:

[`url`Optional](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#url)
A string representing a URL to be shared.

[`text`Optional](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#text)
A string representing text to be shared.

[`title`Optional](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#title)
A string representing a title to be shared. May be ignored by the target.

[`files`Optional](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#files)
An array of [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File) objects representing files to be shared. See [below](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#shareable_file_types) for shareable file types.

### [Return value](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#return_value)

A [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) that resolves with `undefined`, or rejected with one of the [Exceptions](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#exceptions) given below.

### [Exceptions](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#exceptions)

The [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) may be rejected with one of the following `DOMException` values:

`InvalidStateError`[`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)
The document is not fully active, or other sharing operations are in progress.

`NotAllowedError`[`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)
A `web-share`[Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Permissions_Policy) has been used to block the use of this feature, the window does not have [transient activation](https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation), or a file share is being blocked due to security considerations.

[`TypeError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypeError)
The specified share data cannot be validated. Possible reasons include:

*   The `data` parameter was omitted completely or only contains properties with unknown values. Note that any properties that are not recognized by the user agent are ignored.
*   A URL is badly formatted.
*   Files are specified but the implementation does not support file sharing.
*   Sharing the specified data would be considered a "hostile share" by the user-agent.

`AbortError`[`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)
The user canceled the share operation or there are no share targets available.

`DataError`[`DOMException`](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)
There was a problem starting the share target or transmitting the data.

The following is a list of usually shareable file types. However, you should always test with [`navigator.canShare()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare) if sharing would succeed.

*   Application 
    *   `.pdf` - `application/pdf`

*   Audio 
    *   `.flac` - `audio/flac`
    *   `.m4a` - `audio/x-m4a`
    *   `.mp3` - `audio/mpeg` (also accepts `audio/mp3`)
    *   `.oga` - `audio/ogg`
    *   `.ogg` - `audio/ogg`
    *   `.opus` - `audio/ogg`
    *   `.wav` - `audio/wav`
    *   `.weba` - `audio/webm`

*   Image 
    *   `.avif` - `image/avif`
    *   `.bmp` - `image/bmp`
    *   `.gif` - `image/gif`
    *   `.ico` - `image/x-icon`
    *   `.jfif` - `image/jpeg`
    *   `.jpeg` - `image/jpeg`
    *   `.jpg` - `image/jpeg`
    *   `.pjp` - `image/jpeg`
    *   `.pjpeg` - `image/jpeg`
    *   `.png` - `image/png`
    *   `.svg` - `image/svg+xml`
    *   `.svgz` - `image/svg+xml`
    *   `.tif` - `image/tiff`
    *   `.tiff` - `image/tiff`
    *   `.webp` - `image/webp`
    *   `.xbm` - `image/x-xbitmap`

*   Text 
    *   `.css` - `text/css`
    *   `.csv` - `text/csv`
    *   `.ehtml` - `text/html`
    *   `.htm` - `text/html`
    *   `.html` - `text/html`
    *   `.shtm` - `text/html`
    *   `.shtml` - `text/html`
    *   `.text` - `text/plain`
    *   `.txt` - `text/plain`

*   Video 
    *   `.m4v` - `video/mp4`
    *   `.mp4` - `video/mp4`
    *   `.mpeg` - `video/mpeg`
    *   `.mpg` - `video/mpeg`
    *   `.ogm` - `video/ogg`
    *   `.ogv` - `video/ogg`
    *   `.webm` - `video/webm`

## [Security](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#security)

This method requires that the current document have the [web-share](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/web-share) Permissions Policy and [transient activation](https://developer.mozilla.org/en-US/docs/Glossary/Transient_activation). (It must be triggered off a UI event like a button click and cannot be launched at arbitrary points by a script.) Further, the method must specify valid data that is supported for sharing by the native implementation.

## [Examples](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#examples)

### [Sharing a URL](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#sharing_a_url)

The example below shows a button click invoking the Web Share API to share MDN's URL. This is taken from our [Web share test](https://mdn.github.io/dom-examples/web-share/ "External link (opens in new tab)") ([see the source code](https://github.com/mdn/dom-examples/blob/main/web-share/index.html "External link (opens in new tab)")).

#### HTML

The HTML just creates a button to trigger the share, and a paragraph in which to display the result of the test.

html

```
<p><button>Share MDN!</button></p>
<p class="result"></p>
```

#### JavaScript

js

```
const shareData = {
  title: "MDN",
  text: "Learn web development on MDN!",
  url: "https://developer.mozilla.org",
};

const btn = document.querySelector("button");
const resultPara = document.querySelector(".result");

// Share must be triggered by "user activation"
btn.addEventListener("click", async () => {
  try {
    await navigator.share(shareData);
    resultPara.textContent = "MDN shared successfully";
  } catch (err) {
    resultPara.textContent = `Error: ${err}`;
  }
});
```

#### Result

Click the button to launch the share dialog on your platform. Text will appear below the button to indicate whether the share was successful or provide an error code.

### [Sharing files](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#sharing_files)

To share files, first test for and call [`navigator.canShare()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare). Then include the list of files in the call to `navigator.share()`.

#### HTML

html

```
<div>
  <label for="files">Select images to share:</label>
  <input id="files" type="file" accept="image/*" multiple />
</div>
<button id="share" type="button">Share your images!</button>
<output id="output"></output>
```

#### JavaScript

Note that the data object passed to the `navigator.canShare()` only includes the `files` property, as the `title` and `text` shouldn't matter.

js

```
const input = document.getElementById("files");
const output = document.getElementById("output");

document.getElementById("share").addEventListener("click", async () => {
  const files = input.files;

  if (files.length === 0) {
    output.textContent = "No files selected.";
    return;
  }

  // feature detecting navigator.canShare() also implies
  // the same for the navigator.share()
  if (!navigator.canShare) {
    output.textContent = `Your browser doesn't support the Web Share API.`;
    return;
  }

  if (navigator.canShare({ files })) {
    try {
      await navigator.share({
        files,
        title: "Images",
        text: "Beautiful images",
      });
      output.textContent = "Shared!";
    } catch (error) {
      output.textContent = `Error: ${error.message}`;
    }
  } else {
    output.textContent = `Your system doesn't support sharing these files.`;
  }
});
```

#### Result

## [Specifications](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#specifications)

| Specification |
| --- |
| [Web Share API # share-method](https://w3c.github.io/web-share/#share-method) |

## [Browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#browser_compatibility)

Enable JavaScript to view this browser compatibility table.

## [See also](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share#see_also)

*   [`navigator.canShare()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare)
*   [https://wpt.live/web-share/](https://wpt.live/web-share/ "External link (opens in new tab)") (web platform tests)

## Help improve MDN

Was this page helpful to you? 
Yes No

[Learn how to contribute](https://developer.mozilla.org/en-US/docs/MDN/Community/Getting_started)

This page was last modified on Jun 29, 2026 by [MDN contributors](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share/contributors.txt).
