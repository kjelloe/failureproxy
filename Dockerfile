FROM node:14
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .


# Default env variables
ENV PROXYTARGET='http://127.0.0.1:8788'
ENV PROXYLOCALPORT=9000
ENV PROXYMODOPTIONS=1

EXPOSE 9000
CMD ["sh", "-c", "node failureproxy.js $PROXYLOCALPORT $PROXYTARGET $PROXYMODOPTIONS"]
