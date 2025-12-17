ARG BUILD_FROM
FROM $BUILD_FROM

WORKDIR /opt/app

COPY app/requirements.txt /opt/app/requirements.txt
RUN pip install --no-cache-dir -r /opt/app/requirements.txt

COPY app/ /opt/app/app/
COPY frontend/dist/ /opt/app/static/

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
