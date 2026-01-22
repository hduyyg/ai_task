#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
API 服务器连接检查器
"""

import logging

import requests

from .base_checker import BaseChecker

logger = logging.getLogger(__name__)


class ApiServerChecker(BaseChecker):
    """API 服务器连接检查器"""
    
    def check(self, **kwargs) -> bool:
        """
        检查后端 API 服务器是否联通
        
        Returns:
            是否联通
        """
        url = self.config.apiserver_rpc.base_url
        try:
            # 尝试访问 API 服务器（健康检查或根路径）
            response = requests.get(f"{url}/api/health", timeout=10)
            if response.status_code < 500:
                logger.info(f"✓ API 服务器联通: {url}")
                return True
            else:
                self.add_error(f"API 服务器返回错误状态码: {response.status_code}")
                return False
        except requests.exceptions.ConnectionError:
            self.add_error(f"无法连接到 API 服务器: {url}")
            return False
        except requests.exceptions.Timeout:
            self.add_error(f"连接 API 服务器超时: {url}")
            return False
        except Exception as e:
            self.add_error(f"API 服务器检查异常: {e}")
            return False
