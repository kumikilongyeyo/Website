export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  const type = response.headers.get('content-type') || '';
  if ((url.pathname === '/studio' || url.pathname === '/studio/' || url.pathname === '/studio.html') && type.includes('text/html')) {
    return new HTMLRewriter()
      .on('body', {
        element(element) {
          element.append('<script src="/editor-fix.js?v=20260922c"></script>', { html: true });
        }
      })
      .transform(response);
  }
  return response;
}
