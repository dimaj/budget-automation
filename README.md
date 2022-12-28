# Firefly Cron Jobs

This repository contains a collection of cron scripts that will extend/enahnce Firefly-III's already extensive functionality.

## Installation/Configuration
The best way to use these scripts is by hosting them on some NFS server on your home network and volume mapping that location to a `cron` docker container.

### Creating NFS-backed Docker Volume
This assumes you already have an NFS server running and configured. I also assume that the shared folder has the following structure:
```
├── 15min
├── hourly
├── daily
├── monthly
└── weekly
```

```
docker volume create --driver local \
  --opt type=nfs \
  --opt o=addr=[ip-address],ro \
  --opt device=:[path-to-directory] \
  firefly-iii-cron
```
So, if your NFS server is on `192.168.1.17` and your cron scripts are located at `/nfs/shares/firefly-cron`, then you would run:
```
docker volume create --driver local \
  --opt type=nfs \
  --opt o=addr=192.168.1.17,ro,noatime,rsize=8192,wsize=8192,tcp.timeo=14 \
  --opt device=:/nfs/shares/firefly-cron \
  firefly-iii-cron
```
(all the extra params on the `o=addr` line came from creating a volume with Portainer)

### Create a Docker Image for Cron Scripts
If your scripts require anything other than `wget`, you will have to use an image that has your required tool stack pre-installed.
E.g. to take advantage of `jq` and `curl`, you would use a Dockerfile like this:
```
FROM alpine

RUN apk add --no-cache curl jq
```

This very image has been pushed to docker hub under `dimaj/alpine:tools`

### Run Cron Image
Running cron image is as easy as:
```
docker run -d --name=firefly-iii-cron -v firefly-iii-cron:/etc/periodic dimaj/alpine:tools crond -f -l 8
```

or, if you are running Firefly with Docker Compose, use this:
```
version: '3.3'

services:
  app:
    ...
    ports:
      - 49154:8080

  ...
  cron:
    image: dimaj/alpine:tools
    volumes:
      - firefly-iii-cron:/etc/periodic
    command: crond -f -l 8


volumes:
   ...
   firefly-iii-cron:
     driver_opts:
       type: "nfs"
       o: "addr=192.168.1.17,ro,noatime,rsize=8192,wsize=8192,tcp,timeo=14"
       device: ":/nfs/shares/firefly-cron"
```

## Current Scripts
| Script Name | Period | Description |
| ----------- | ------ | ----------- |
| [run-rules.sh](./cron/15min/run-rules.sh) | 15 minutes | Run existing rules on all transactions between yesterday and today |
| [prune-empty-accounts.sh](./cron/15min/prune-empty-accounts.sh) | 15 minutes | Delete `expesnse` accounts whose balance is `0.00` |