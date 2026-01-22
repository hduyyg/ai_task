#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
基础检查器类
"""

import logging
from abc import ABC, abstractmethod
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from config.config_model import ClientConfig

logger = logging.getLogger(__name__)


class BaseChecker(ABC):
    """检查器基类"""
    
    def __init__(self, config: "ClientConfig"):
        """
        初始化检查器
        
        Args:
            config: 客户端配置
        """
        self.config = config
        self.errors: List[str] = []
        self.warnings: List[str] = []
    
    def add_error(self, message: str):
        """添加错误信息"""
        self.errors.append(message)
    
    def add_warning(self, message: str):
        """添加警告信息"""
        self.warnings.append(message)
    
    def clear_messages(self):
        """清空错误和警告信息"""
        self.errors = []
        self.warnings = []
    
    @abstractmethod
    def check(self, **kwargs) -> bool:
        """
        执行检查
        
        Returns:
            是否通过检查
        """
        pass
