
FROM node:26-alpine AS dev

WORKDIR /app

COPY . .

RUN npm install

CMD [ "npm", "start" ]
