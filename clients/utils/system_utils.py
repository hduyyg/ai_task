#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
系统工具函数
"""

import logging
import os

logger = logging.getLogger(__name__)


def ensure_dir_exists(dir_path: str) -> None:
    """
    确保目录存在，逐级创建多级目录并记录日志
    
    Args:
        dir_path: 目录路径
    """
    if os.path.exists(dir_path):
        return
    
    # 逐级创建目录并记录日志
    parts = os.path.normpath(dir_path).split(os.sep)
    current_path = ""
    
    for part in parts:
        if not part:
            continue
        # 处理 Windows 盘符（如 C:）和 Unix 根目录
        if current_path == "":
            if os.name == 'nt' and ':' in part:
                current_path = part + os.sep
            else:
                current_path = os.sep + part
        else:
            current_path = os.path.join(current_path, part)
        
        if not os.path.exists(current_path):
            os.mkdir(current_path)
            logger.info(f"创建目录: {current_path}")

