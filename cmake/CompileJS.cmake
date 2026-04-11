set(_COMPILE_JS_DIR "${CMAKE_CURRENT_LIST_DIR}")

function(compile_js_to_xs JS_INPUT OUTPUT_DIR OUTPUT_NAME)
    include(${_COMPILE_JS_DIR}/BuildXSC.cmake)

    set(_xs_c "${OUTPUT_DIR}/${OUTPUT_NAME}.xs.c")
    set(_xs_h "${OUTPUT_DIR}/${OUTPUT_NAME}.xs.h")

    add_custom_command(
        OUTPUT ${_xs_c} ${_xs_h}
        COMMAND ${XSC_BINARY} "${JS_INPUT}" -o "${OUTPUT_DIR}" -r "${OUTPUT_NAME}" -p
        DEPENDS host_xsc "${JS_INPUT}"
        COMMENT "Compiling ${JS_INPUT} -> XS bytecode"
        VERBATIM
    )

    add_custom_target(xs_compiled_app DEPENDS ${_xs_c} ${_xs_h})

    set(XS_COMPILED_SOURCE ${_xs_c} PARENT_SCOPE)
    set(XS_COMPILED_HEADER_DIR ${OUTPUT_DIR} PARENT_SCOPE)
endfunction()
