FROM python:3.12-slim

WORKDIR /app

# Instala as dependências primeiro (camada cacheada — só reinstala se requirements.txt mudar)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código da aplicação
COPY app/ ./app/
COPY mcp_servers/ ./mcp_servers/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
