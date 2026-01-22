#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
配置模型定义 - 使用 dataclass 映射配置文件
"""

from dataclasses import dataclass, field
try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:
    import tomli as tomllib  # Python 3.10 及以下


@dataclass
class ServerConfig:
    """服务器配置"""
    host: str = "0.0.0.0"
    port: int = 8105
    debug: bool = False
    url_prefix: str = ""  # URL 前缀，例如 "/v1"，为空则不添加前缀


@dataclass
class DatabaseConfig:
    """数据库配置（MySQL）"""
    type: str = "mysql"
    url: str = "127.0.0.1"
    port: int = 3306
    username: str = "root"
    password: str = ""
    database: str = "ai_task"
    
    def get_connection_url(self) -> str:
        """获取数据库连接URL"""
        return f"mysql+pymysql://{self.username}:{self.password}@{self.url}:{self.port}/{self.database}"


@dataclass
class HeartbeatConfig:
    """心跳保活配置"""
    timeout_seconds: int = 10  # 心跳超时阈值（秒），超过该时间视为客户端离线


@dataclass
class AppConfig:
    """应用总配置"""
    server: ServerConfig = field(default_factory=ServerConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    heartbeat: HeartbeatConfig = field(default_factory=HeartbeatConfig)
    
    @classmethod
    def from_toml(cls, path: str) -> "AppConfig":
        """从 TOML 文件加载配置"""
        with open(path, "rb") as f:
            data = tomllib.load(f)
        
        return cls(
            server=ServerConfig(**data.get("server", {})),
            database=DatabaseConfig(**data.get("database", {})),
            heartbeat=HeartbeatConfig(**data.get("heartbeat", {}))
        )


# 使用示例
if __name__ == "__main__":
    config = AppConfig.from_toml("config.toml")
    print(f"Server: {config.server.host}:{config.server.port}")
    print(f"Database: {config.database.type} @ {config.database.url}:{config.database.port}/{config.database.database}")
