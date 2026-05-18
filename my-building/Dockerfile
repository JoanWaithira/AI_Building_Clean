FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_FORECAST_API_BASE
ARG VITE_GATE_API_BASE
ARG VITE_GATE_API_KEY
ARG VITE_MCP_API_URL
ARG VITE_MCP_CHAT_PATH

ENV VITE_FORECAST_API_BASE=$VITE_FORECAST_API_BASE
ENV VITE_GATE_API_BASE=$VITE_GATE_API_BASE
ENV VITE_GATE_API_KEY=$VITE_GATE_API_KEY
ENV VITE_MCP_API_URL=$VITE_MCP_API_URL
ENV VITE_MCP_CHAT_PATH=$VITE_MCP_CHAT_PATH

RUN npm run build

FROM nginx:1.27-alpine

RUN mkdir -p /usr/share/nginx/html/gate-building-ai
RUN mkdir -p /usr/share/nginx/html/gate-building-ai/cesium

COPY --from=build /app/dist /usr/share/nginx/html/gate-building-ai
COPY --from=build /app/node_modules/cesium/Build/Cesium /usr/share/nginx/html/gate-building-ai/cesium

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80