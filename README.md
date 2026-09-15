# EIDOS portable export

This archive contains a static copy of the EIDOS test site, including its HTML, CSS, JavaScript, images, fonts, and the PDF files for all 42 role combinations.

## Deploy on Netlify

1. Unzip the archive.
2. In Netlify, choose **Add new project** and import this folder or its GitHub repository.
3. Netlify should use the included `netlify.toml` file. The publish directory is the project root.

The site files use relative paths, so the exported folder can also be opened locally through a static web server.

## Structure

- `index.html` - site entry point
- `assets/` - CSS, JavaScript, and fonts
- `characters/`, `role-title-images/`, `result-role-images/` - visual assets
- `result-pdfs/` - 42 downloadable result PDFs
