FROM nginx:1.27-alpine

# Copy custom nginx config to serve the static app with basic caching headers.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the web assets into the default nginx web root.
COPY index.html styles.css app.js README.md /usr/share/nginx/html/

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
