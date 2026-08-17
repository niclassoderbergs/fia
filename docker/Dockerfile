# Körmiljö för importern.
#
# Imagen innehåller bara verktygen — koden och node_modules kommer från
# bind-mounten av repot. Det gör att en kodändring inte kräver ombygge av
# imagen, och att git-arbetsträdet containern committar i är samma träd som
# ligger på servern.
FROM node:22-alpine

# git + openssh: containern gör commit och push själv.
# tzdata: importen loggar och namnger commits i svensk tid.
RUN apk add --no-cache git openssh-client tzdata

ENV TZ=Europe/Stockholm \
    NEXT_TELEMETRY_DISABLED=1

COPY entrypoint.sh /usr/local/bin/fia-import
RUN chmod +x /usr/local/bin/fia-import

WORKDIR /app
ENTRYPOINT ["/usr/local/bin/fia-import"]
